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
    // Oldest/newest month from `reportMonth` / `reportDataMonth` only (YYYY-MM → ISO).
    // Documents without a valid month field are excluded from the Timespan min/max; see periodsFound.
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
        "Pearlman AI: explains how this MongoDB stores parsed PDF reports, and lists all current non-system databases (properties) with their collections (reports) and per-collection TimeSpan from `reportMonth` / `reportDataMonth` only. Requires an active MongoDB connection.";

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
     * Timespan (oldest/newest) uses only `reportMonth`, else legacy `reportDataMonth`
     * when both are strings matching `YYYY-MM`. No text/segment heuristics.
     */
    private async fetchCollectionStats(
        provider: Awaited<ReturnType<typeof this.ensureConnected>>,
        dbName: string,
        colName: string,
        signal: AbortSignal
    ): Promise<{ count: number; oldest: string | null; newest: string | null; periodsFound: number }> {
        try {
            const yyyymmRegex = "^(\\d{4})-(\\d{2})$";
            const pipeline = [
                {
                    $addFields: {
                        _reportFromStored: {
                            $cond: [
                                {
                                    $regexMatch: {
                                        input: { $toString: { $ifNull: ["$reportMonth", ""] } },
                                        regex: yyyymmRegex,
                                    },
                                },
                                {
                                    $dateFromString: {
                                        dateString: {
                                            $concat: [{ $toString: { $ifNull: ["$reportMonth", ""] } }, "-01"],
                                        },
                                        onError: null,
                                        onNull: null,
                                    },
                                },
                                {
                                    $cond: [
                                        {
                                            $regexMatch: {
                                                input: { $toString: { $ifNull: ["$reportDataMonth", ""] } },
                                                regex: yyyymmRegex,
                                            },
                                        },
                                        {
                                            $dateFromString: {
                                                dateString: {
                                                    $concat: [
                                                        { $toString: { $ifNull: ["$reportDataMonth", ""] } },
                                                        "-01",
                                                    ],
                                                },
                                                onError: null,
                                                onNull: null,
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
                    $addFields: {
                        _reportDate: "$_reportFromStored",
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
