import { z } from "zod";
import type { ToolResult } from "../tool.js";
import type { ToolArgs, ToolExecutionContext } from "../tool.js";
import { MongoDBToolBase } from "../mongodb/mongodbTool.js";
import type { OperationType, ToolCategory } from "../tool.js";
import { PEARL_MANAI_GUIDE_HIDDEN_DATABASES } from "../../common/pearlmanaiConversationLog.js";
import { PEARL_MANAI_SYSTEM_DATABASES } from "../../common/pearlmanaiParsedReportsGuide.js";

export const PearlmanaiGuideCollectionSchema = z.object({
    name: z.string(),
    documentCount: z.number(),
    // Oldest/newest reporting period extracted from the document text (ISO strings, null if
    // no period could be determined). Prefers "Report Period: MM/YY" markers, falls back to
    // the first M/D/YYYY date found in the document's text content.
    oldestPeriod: z.string().nullable(),
    newestPeriod: z.string().nullable(),
    periodsFound: z.number(),
});

export const PearlmanaiGuidePropertySchema = z.object({
    dbName: z.string(),
    collections: z.array(PearlmanaiGuideCollectionSchema),
});

export const PearlmanaiGuideOutputSchema = {
    properties: z.array(PearlmanaiGuidePropertySchema),
    generatedAt: z.string(),
};

export type PearlmanaiGuideOutput = z.infer<z.ZodObject<typeof PearlmanaiGuideOutputSchema>>;

/**
 * Pearlman domain guide plus a live list of databases (properties) and collections (reports).
 * Returns both markdown text content and structured output for UI rendering.
 */
export class PearlmanaiParsedReportsGuideTool extends MongoDBToolBase {
    static toolName = "pearlmanai-parsed-reports-guide";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";

    public description =
        "Pearlman AI: explains how this MongoDB stores parsed PDF reports, and lists all current non-system databases (properties) with their collections (reports) and import time spans. Requires an active MongoDB connection.";

    public argsShape = {};
    public override outputSchema = PearlmanaiGuideOutputSchema;

    protected async execute(
        _args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const dbs = (await provider.listDatabases("")).databases as { name: string }[];

        const propertyDbNames = dbs
            .map((d) => d.name)
            .filter(
                (name) =>
                    !PEARL_MANAI_SYSTEM_DATABASES.has(name) && !PEARL_MANAI_GUIDE_HIDDEN_DATABASES.has(name)
            )
            .sort((a, b) => a.localeCompare(b));

        const properties: PearlmanaiGuideOutput["properties"] = [];
        const inventoryItems: { propertyDbName: string; reportCollections: string[] }[] = [];

        for (const dbName of propertyDbNames) {
            const cols = await provider.listCollections(dbName, {}, { signal: context.signal });
            const collectionNames = cols
                .map((c) => c.name as string)
                .filter((n) => !n.startsWith("system."))
                .sort((a, b) => a.localeCompare(b));

            inventoryItems.push({ propertyDbName: dbName, reportCollections: collectionNames });

            const collections: PearlmanaiGuideOutput["properties"][number]["collections"] = [];

            for (const colName of collectionNames) {
                const stats = await this.fetchCollectionStats(provider, dbName, colName, context.signal);
                collections.push({
                    name: colName,
                    documentCount: stats.count,
                    oldestPeriod: stats.oldest,
                    newestPeriod: stats.newest,
                    periodsFound: stats.periodsFound,
                });
            }

            properties.push({ dbName, collections });
        }

        const totalReports = properties.reduce((n, p) => n + p.collections.length, 0);

        return {
            content: [
                {
                    type: "text",
                    text: `Found ${properties.length} ${properties.length === 1 ? "property" : "properties"} with ${totalReports} ${totalReports === 1 ? "report" : "reports"} total. See the UI for the full inventory.`,
                },
            ],
            structuredContent: {
                properties,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * Extract per-document reporting periods from free-text content.
     *
     * Pearlman's parsed reports do not store a structured period field — the reporting
     * period lives inside `content.segments[*].text`. We concatenate segment text and run
     * two regexes in preference order:
     *   1. "Report Period: MM/YY"   → canonical month the report covers (day set to 1).
     *   2. First "M/D/YYYY" date    → report-generation or period-end date (fallback).
     *
     * Collections where no match is found (e.g. `management_fee_calculation`) return
     * null period bounds and `periodsFound: 0`.
     */
    private async fetchCollectionStats(
        provider: Awaited<ReturnType<typeof this.ensureConnected>>,
        dbName: string,
        colName: string,
        signal: AbortSignal
    ): Promise<{ count: number; oldest: string | null; newest: string | null; periodsFound: number }> {
        try {
            const pipeline = [
                {
                    $addFields: {
                        _allText: {
                            $reduce: {
                                input: { $ifNull: ["$content.segments", []] },
                                initialValue: "",
                                in: { $concat: ["$$value", " ", { $ifNull: ["$$this.text", ""] }] },
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        _periodMatch: {
                            $regexFind: {
                                input: "$_allText",
                                regex: /Report Period:\s*([0-9]{1,2})\/([0-9]{2,4})/,
                                options: "i",
                            },
                        },
                        _dateMatch: {
                            $regexFind: {
                                input: "$_allText",
                                regex: /([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})/,
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        _reportDate: {
                            $cond: [
                                { $ne: ["$_periodMatch", null] },
                                {
                                    $dateFromParts: {
                                        year: {
                                            $let: {
                                                vars: { y: { $arrayElemAt: ["$_periodMatch.captures", 1] } },
                                                in: {
                                                    $cond: [
                                                        { $lte: [{ $strLenCP: "$$y" }, 2] },
                                                        { $toInt: { $concat: ["20", "$$y"] } },
                                                        { $toInt: "$$y" },
                                                    ],
                                                },
                                            },
                                        },
                                        month: { $toInt: { $arrayElemAt: ["$_periodMatch.captures", 0] } },
                                        day: 1,
                                    },
                                },
                                {
                                    $cond: [
                                        { $ne: ["$_dateMatch", null] },
                                        {
                                            $dateFromParts: {
                                                year: { $toInt: { $arrayElemAt: ["$_dateMatch.captures", 2] } },
                                                month: { $toInt: { $arrayElemAt: ["$_dateMatch.captures", 0] } },
                                                day: { $toInt: { $arrayElemAt: ["$_dateMatch.captures", 1] } },
                                            },
                                        },
                                        null,
                                    ],
                                },
                            ],
                        },
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        oldest: { $min: "$_reportDate" },
                        newest: { $max: "$_reportDate" },
                        periodsFound: { $sum: { $cond: [{ $ne: ["$_reportDate", null] }, 1, 0] } },
                    },
                },
            ];

            const cursor = provider.aggregate(dbName, colName, pipeline, { signal });
            const results = [];
            for await (const doc of cursor) {
                results.push(doc);
            }

            if (results.length === 0 || !results[0]) {
                return { count: 0, oldest: null, newest: null, periodsFound: 0 };
            }

            const row = results[0] as {
                count?: number;
                oldest?: unknown;
                newest?: unknown;
                periodsFound?: number;
            };
            const toIso = (v: unknown): string | null =>
                v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

            return {
                count: typeof row.count === "number" ? row.count : 0,
                oldest: toIso(row.oldest),
                newest: toIso(row.newest),
                periodsFound: typeof row.periodsFound === "number" ? row.periodsFound : 0,
            };
        } catch {
            // Fallback: at least return the count if the period aggregation fails.
            try {
                const pipeline = [{ $group: { _id: null, count: { $sum: 1 } } }];
                const cursor = provider.aggregate(dbName, colName, pipeline, { signal });
                for await (const doc of cursor) {
                    const row = doc as { count?: number };
                    return {
                        count: typeof row.count === "number" ? row.count : 0,
                        oldest: null,
                        newest: null,
                        periodsFound: 0,
                    };
                }
            } catch {
                // ignore
            }
            return { count: 0, oldest: null, newest: null, periodsFound: 0 };
        }
    }
}
