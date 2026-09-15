import type { FastMCP } from "fastmcp";
import { z } from "zod";

import type { ToolAccessGuard } from "../auth.js";
import { REPORT_TYPES } from "../catalog.js";
import { getCoverage } from "./coverage.js";
import { getReport, getSource, ReportLookupError } from "./report.js";

function jsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const reportType = z.enum(
  REPORT_TYPES as unknown as [string, ...string[]],
);
const basis = z.enum(["accrual", "cash"]);

export function registerTools(
  server: FastMCP,
  toolAccess?: ToolAccessGuard,
): void {
  const access = toolAccess ? { canAccess: toolAccess } : {};

  server.addTool({
    ...access,
    name: "get_coverage",
    description:
      "What financial reports exist: properties, report types, months, and document counts. Call this first. Muse has no parsed reports. Corbett is June 2026 only and has no income statement. There is no August 2026 package. This connector has no cash flow data.",
    parameters: z.object({}),
    execute: async () => jsonResult(await getCoverage()),
  });

  server.addTool({
    ...access,
    name: "get_report",
    description:
      "Return one whole financial report in printed order: header text and every table row as printed strings. One report per call. Amounts stay as they were printed (commas, parentheses). Column keys come from that month's own titles and change by month. Statements usually arrive complete; large ledgers page (default 2000 rows). There is no row search; read the returned report yourself.",
    parameters: z.object({
      property_id: z
        .string()
        .describe("Property id or alias (1050, 548→530, 460→9810, The Muse→Muse, Timbers, Corbett)."),
      report: reportType.describe(
        "income_statement | standard_balance_sheet | forecast_budget_report | general_ledger",
      ),
      period: z
        .string()
        .optional()
        .describe("YYYY-MM. Required. Forecasts also use this as the report-run month."),
      as_of: z
        .string()
        .optional()
        .describe("Accepted as an alias of period."),
      basis: basis
        .optional()
        .describe("accrual or cash. Not stored on the document; use coverage/catalog. Never mix bases."),
      offset: z.number().int().min(0).optional().describe("Row offset for paging (ledgers)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe("Row page size. Default 2000."),
    }),
    execute: async (args) => {
      try {
        return jsonResult(
          await getReport({
            ...args,
            report: args.report as (typeof REPORT_TYPES)[number],
          }),
        );
      } catch (error) {
        if (error instanceof ReportLookupError) {
          return jsonResult({ error: error.message });
        }
        throw error;
      }
    },
  });

  server.addTool({
    ...access,
    name: "get_source",
    description:
      "Return the original extracted page text and provenance for one report, so a figure can be traced to the printed page.",
    parameters: z.object({
      property_id: z.string(),
      report: reportType,
      period: z.string().optional(),
      as_of: z.string().optional(),
      basis: basis.optional(),
    }),
    execute: async (args) => {
      try {
        return jsonResult(
          await getSource({
            ...args,
            report: args.report as (typeof REPORT_TYPES)[number],
          }),
        );
      } catch (error) {
        if (error instanceof ReportLookupError) {
          return jsonResult({ error: error.message });
        }
        throw error;
      }
    },
  });
}
