import type { FastMCP } from "fastmcp";
import { z } from "zod";

import type { ToolAccessGuard } from "../auth.js";
import { REPORT_TYPES } from "../catalog.js";
import { getDb } from "../db.js";
import { getCoverage } from "./coverage.js";
import { getReport, getSource, getYearReport, ReportLookupError } from "./report.js";
import { searchLineItems } from "./search.js";

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
      "What financial reports exist: properties, report types, periods, accounting bases, document counts, and row counts. Use this to answer 'what is loaded', not as a shopping list of get_report calls. For a named line (NOI, a total, an account) across properties or months, call search_line_items instead. This connector has no cash flow data.",
    parameters: z.object({}),
    execute: async () => jsonResult(await getCoverage(getDb())),
  });

  server.addTool({
    ...access,
    name: "search_line_items",
    description:
      "Return matching printed rows from one report type, across every property and every month in one call. This is the tool for net operating income, totals, or any named line — never loop get_report for that. Label is a case-insensitive substring (not a metric name). For net operating income search label \"net operating\". Searching \"NOI\" alone misses MRI statements. Pass year=2026 (or period=2026) for a calendar year; pass YYYY-MM only when you want one month. Omit property_id to search all properties. Pass basis so cash and accrual are not mixed — two searches (cash, then accrual) if the year spans both. Bell Ranch has two income-statement layouts that agree; pass layout or do not add both. Default 500 rows, then page with offset.",
    parameters: z.object({
      report: reportType.describe(
        "income_statement | standard_balance_sheet | forecast_budget_report | general_ledger",
      ),
      label: z
        .string()
        .optional()
        .describe("Case-insensitive substring of the printed label. Required unless account_code is set."),
      account_code: z
        .string()
        .optional()
        .describe("Exact account code as stored (for example 5755-0000)."),
      property_id: z
        .string()
        .optional()
        .describe("Restrict to one property. Omit to search all properties."),
      year: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Calendar year YYYY (for example 2026). All months of that year in one call."),
      period: z
        .string()
        .optional()
        .describe("YYYY-MM for one month, or YYYY for a whole year. Forecasts also accept this as the report-run month."),
      as_of: z.string().optional().describe("Forecast report-run YYYY-MM or YYYY. Alias of period for forecasts."),
      basis: basis.optional().describe("accrual or cash. Pass this for money questions; never mix bases."),
      layout: layout
        .optional()
        .describe("mri | appfolio | essex. Use when Bell Ranch would otherwise return both income statements."),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(2000).optional().describe("Default 500."),
    }),
    execute: async (args) => {
      try {
        return jsonResult(
          await searchLineItems(getDb(), {
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
    name: "get_report",
    description:
      "Return one whole financial report for one property and one month. Do not use this to collect a named line across properties or months — that is search_line_items, usually one or two calls. Use get_report only when the caller wants the full printed statement. Statements arrive complete; general ledgers page (default 2000 rows). For Bell Ranch income statements you must pass layout (mri or essex) — the two statements agree and must not be added together.",
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
    name: "get_year_report",
    description:
      "Return every monthly statement of one report type for one property and one calendar year. One property, one year, one basis, one report type — the year-wide version of get_report. Each month comes back as a whole printed report (header, column titles, every row). Missing months are listed, not filled in. For a named line across properties, use search_line_items instead. Income statements, balance sheets, and forecasts return all months in one call (default 12). General ledgers are large: default one month of that year per call, then page with offset. Bell Ranch income statements need layout (mri or essex).",
    parameters: z.object({
      property_id: z
        .string()
        .describe("Property id or alias (1050, 548→530, 460→9810, The Muse→Muse, Timbers, Corbett)."),
      report: reportType.describe(
        "income_statement | standard_balance_sheet | forecast_budget_report | general_ledger",
      ),
      year: z
        .union([z.string(), z.number()])
        .describe("Calendar year YYYY (for example 2024)."),
      basis: basis.describe("accrual or cash. Never mix."),
      layout: layout
        .optional()
        .describe("Required when Bell Ranch has two income statements (mri vs essex)."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Skip this many months that exist in the year (not calendar gaps)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Months to return. Default 12 for statements; default 1 for general ledgers."),
    }),
    execute: async (args) => {
      try {
        return jsonResult(
          await getYearReport(getDb(), {
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
