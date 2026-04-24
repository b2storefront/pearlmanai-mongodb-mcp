import { z } from "zod";
import type { ToolResult } from "../tool.js";
import type { ToolArgs, ToolExecutionContext } from "../tool.js";
import { MongoDBToolBase } from "../mongodb/mongodbTool.js";
import type { OperationType, ToolCategory } from "../tool.js";
import { PEARL_MANAI_GUIDE_HIDDEN_DATABASES } from "../../common/pearlmanaiConversationLog.js";
import { PEARL_MANAI_SYSTEM_DATABASES } from "../../common/pearlmanaiParsedReportsGuide.js";

export const PearlmanaiGuideReportSchema = z.object({
    /** MongoDB collection name (one report per property). */
    name: z.string(),
    /** One document = one month for this report. */
    documentCount: z.number(),
    /** Earliest `reportMonth` in this report (ISO, start of month). */
    oldestPeriod: z.string().nullable(),
    /** Latest `reportMonth` in this report (ISO, start of month). */
    newestPeriod: z.string().nullable(),
    /** Documents with a valid `reportMonth` included in the range (normally equals documentCount). */
    withReportMonth: z.number(),
});

export const PearlmanaiGuidePropertySchema = z.object({
    dbName: z.string(),
    reports: z.array(PearlmanaiGuideReportSchema),
});

export const PearlmanaiGuideOutputSchema = {
    properties: z.array(PearlmanaiGuidePropertySchema),
    generatedAt: z.string(),
};

export type PearlmanaiGuideOutput = z.infer<z.ZodObject<typeof PearlmanaiGuideOutputSchema>>;

/**
 * Pearlman domain guide: list every property (database), every report (collection), document counts
 * and month span from `reportMonth` only. One document = one month.
 */
export class PearlmanaiParsedReportsGuideTool extends MongoDBToolBase {
    static toolName = "pearlmanai-parsed-reports-guide";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";

    public description =
        "Pearlman AI: how parsed PDFs are stored, plus a full inventory: each property (database), each report (collection) with a document count (one month per document), and the month range from `reportMonth` only. Requires an active MongoDB connection.";

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
            const reportNames = cols
                .map((c) => c.name as string)
                .filter((n) => !n.startsWith("system."))
                .sort((a, b) => a.localeCompare(b));

            inventoryItems.push({ propertyDbName: dbName, reportCollections: reportNames });

            const reports: PearlmanaiGuideOutput["properties"][number]["reports"] = [];

            for (const reportName of reportNames) {
                const stats = await this.fetchReportStats(provider, dbName, reportName, context.signal);
                reports.push({
                    name: reportName,
                    documentCount: stats.count,
                    oldestPeriod: stats.oldest,
                    newestPeriod: stats.newest,
                    withReportMonth: stats.withReportMonth,
                });
            }

            properties.push({ dbName, reports });
        }

        const totalReports = properties.reduce((n, p) => n + p.reports.length, 0);

        return {
            content: [
                {
                    type: "text",
                    text: `Found ${properties.length} ${properties.length === 1 ? "property" : "properties"} and ${totalReports} ${totalReports === 1 ? "report" : "reports"} (collections). Each document is one month; the UI lists counts and the month range from \`reportMonth\` only.`,
                },
            ],
            structuredContent: {
                properties,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * `reportMonth` only: string `YYYY-MM` or BSON date → sortable first-of-month date for min/max.
     */
    private async fetchReportStats(
        provider: Awaited<ReturnType<typeof this.ensureConnected>>,
        dbName: string,
        colName: string,
        signal: AbortSignal
    ): Promise<{ count: number; oldest: string | null; newest: string | null; withReportMonth: number }> {
        const yyyyMmStringToDate = (field: string) => ({
            $dateFromString: {
                dateString: { $concat: [field, "-01"] },
                onError: null,
                onNull: null,
            },
        });
        const isYyyyMmString = (field: string) => ({
            $and: [
                { $eq: [{ $type: field }, "string"] },
                { $eq: [{ $strLenCP: field }, 7] },
                { $eq: [{ $substrCP: [field, 4, 1] }, "-"] },
            ],
        });
        const firstOfMonthFromDate = (field: string) => ({
            $dateFromParts: {
                year: { $year: field },
                month: { $month: field },
                day: 1,
            },
        });
        const reportMonthToDate = {
            $switch: {
                branches: [
                    { case: { $eq: [{ $type: "$reportMonth" }, "date"] }, then: firstOfMonthFromDate("$reportMonth") },
                    { case: isYyyyMmString("$reportMonth"), then: yyyyMmStringToDate("$reportMonth") },
                ],
                default: null,
            },
        };
        const pipeline = [
            { $addFields: { _reportDate: reportMonthToDate } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    oldest: { $min: "$_reportDate" },
                    newest: { $max: "$_reportDate" },
                    withReportMonth: { $sum: { $cond: [{ $ne: ["$_reportDate", null] }, 1, 0] } },
                },
            },
        ];

        try {
            const cursor = provider.aggregate(dbName, colName, pipeline, { signal });
            const results: unknown[] = [];
            for await (const doc of cursor) {
                results.push(doc);
            }

            if (results.length === 0 || !results[0]) {
                return { count: 0, oldest: null, newest: null, withReportMonth: 0 };
            }

            const row = results[0] as {
                count?: number;
                oldest?: unknown;
                newest?: unknown;
                withReportMonth?: number;
            };
            const toIso = (v: unknown): string | null =>
                v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

            return {
                count: typeof row.count === "number" ? row.count : 0,
                oldest: toIso(row.oldest),
                newest: toIso(row.newest),
                withReportMonth: typeof row.withReportMonth === "number" ? row.withReportMonth : 0,
            };
        } catch {
            try {
                const countPipeline = [{ $group: { _id: null, count: { $sum: 1 } } }];
                const cursor = provider.aggregate(dbName, colName, countPipeline, { signal });
                for await (const doc of cursor) {
                    const row = doc as { count?: number };
                    return {
                        count: typeof row.count === "number" ? row.count : 0,
                        oldest: null,
                        newest: null,
                        withReportMonth: 0,
                    };
                }
            } catch {
                // ignore
            }
            return { count: 0, oldest: null, newest: null, withReportMonth: 0 };
        }
    }
}
