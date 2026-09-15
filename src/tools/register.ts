import type { FastMCP } from "fastmcp";
import { z } from "zod";

import type { ToolAccessGuard } from "../auth.js";
import { REPORT_TYPES } from "../catalog.js";
import { getDb } from "../db.js";
import { getCoverage } from "./coverage.js";
import { getReport, getSource, ReportLookupError } from "./report.js";

function jsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const reportType = z.enum(
  REPORT_TYPES as unknown as [string, ...string[]],
);
const basis = z.enum(["accrual", "cash"]);
const layout = z.enum(["mri", "appfolio", "essex"]);

export function registerTools(
  server: FastMCP,
  toolAccess?: ToolAccessGuard,
): void {
  const access = toolAccess ? { canAccess: toolAccess } : {};

  server.addTool({
    ...access,
    name: "get_coverage",
    description:
      "What financial reports exist: properties, report types, periods, accounting bases, document counts, and row counts per report so you know what a fetch will cost. Call this first. This connector has no cash flow data.",
    parameters: z.object({}),
    execute: async () => jsonResult(await getCoverage(getDb())),
  });

  server.addTool({
    ...access,
    name: "get_report",
    description:
      "Return one whole financial report in printed order: header text, column-title rows, and every table row with named measures plus verbatim cells. One report per call. Statements arrive complete; general ledgers page (default 2000 rows). For Bell Ranch income statements you must pass layout (mri or essex) — the two statements agree and must not be added together. There is no row search; read the returned report yourself.",
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
        .describe("YYYY-MM. Required except for forecasts (use as_of)."),
      as_of: z
        .string()
        .optional()
        .describe("Forecast report run YYYY-MM. You may also pass this as period."),
      basis: basis.describe("accrual or cash. Never mix."),
      layout: layout
        .optional()
        .describe("Required when Bell Ranch has two income statements (mri vs essex)."),
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
          await getReport(getDb(), {
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
      "Return the original extracted markdown and provenance for one report, so a figure can be traced to the printed page.",
    parameters: z.object({
      property_id: z.string(),
      report: reportType,
      period: z.string().optional(),
      as_of: z.string().optional(),
      basis: basis,
      layout: layout.optional(),
    }),
    execute: async (args) => {
      try {
        return jsonResult(
          await getSource(getDb(), {
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
