import type { Db, Document } from "mongodb";

import {
  REPORT_TYPES,
  requireProperty,
  type AccountingBasis,
  type ReportType,
} from "../catalog.js";
import { ReportLookupError } from "./report.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export interface SearchLineItemsArgs {
  report: ReportType;
  label?: string;
  account_code?: string;
  property_id?: string;
  period?: string;
  as_of?: string;
  basis?: AccountingBasis;
  layout?: "mri" | "appfolio" | "essex";
  offset?: number;
  limit?: number;
}

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as string[]).includes(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function ensureSearchIndexes(db: Db): Promise<void> {
  try {
    await db.collection("income_statement").createIndex(
      { period: 1, basis: 1, property_id: 1 },
      { name: "search_period" },
    );
    await db.collection("standard_balance_sheet").createIndex(
      { period: 1, basis: 1, property_id: 1 },
      { name: "search_period" },
    );
    await db.collection("forecast_budget_report").createIndex(
      { as_of: 1, basis: 1, property_id: 1 },
      { name: "search_as_of" },
    );
    await db.collection("general_ledger").createIndex(
      { period: 1, property_id: 1 },
      { name: "search_period" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pearlmanai-reports-mcp] search indexes skipped: ${message}`);
  }
}

function duplicateLayoutWarning(rows: Document[]): string | undefined {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const layout = typeof row.layout === "string" ? row.layout : "";
    if (!layout) {
      continue;
    }
    const key = `${row.property_id}|${row.period ?? row.as_of}`;
    const layouts = seen.get(key) ?? new Set<string>();
    layouts.add(layout);
    seen.set(key, layouts);
  }
  const overlaps = [...seen.entries()].filter(([, layouts]) => layouts.size > 1);
  if (overlaps.length === 0) {
    return undefined;
  }
  return (
    "Some properties have two matching income statements (mri and essex) that agree. " +
    "Pass layout to pick one; do not add both."
  );
}

export async function searchLineItems(db: Db, args: SearchLineItemsArgs) {
  if (!isReportType(args.report)) {
    throw new ReportLookupError(
      `Unknown report "${args.report}". Use one of: ${REPORT_TYPES.join(", ")}.`,
    );
  }
  const label = args.label?.trim();
  const accountCode = args.account_code?.trim();
  if (!label && !accountCode) {
    throw new ReportLookupError("Pass label or account_code to search.");
  }

  const filter: Document = {};
  if (args.property_id) {
    filter.property_id = requireProperty(args.property_id)._id;
  }
  if (args.basis) {
    filter.basis = args.basis;
  }
  if (args.layout) {
    filter.layout = args.layout;
  }

  const asOf = args.as_of ?? args.period;
  const period = args.period ?? args.as_of;
  if (args.report === "forecast_budget_report") {
    if (asOf) {
      filter.as_of = asOf;
    }
  } else if (period) {
    filter.period = period;
  }

  if (label) {
    filter.label = { $regex: escapeRegex(label), $options: "i" };
  }
  if (accountCode) {
    filter.account_code = accountCode;
  }

  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
  const collection = db.collection(args.report);
  const totalRows = await collection.countDocuments(filter);
  const rows = await collection
    .find(filter)
    .sort({ property_id: 1, period: 1, as_of: 1, row_index: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  const properties = [...new Set(rows.map((row) => String(row.property_id)))].sort();
  const periods = [
    ...new Set(
      rows
        .map((row) => (row.period ?? row.as_of) as string | null)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ].sort();
  const bases = [
    ...new Set(
      rows
        .map((row) => row.basis as string | undefined)
        .filter((value): value is string => typeof value === "string"),
    ),
  ].sort();

  const warnings: string[] = [];
  if (bases.length > 1) {
    warnings.push(
      `Results mix ${bases.join(" and ")}. Cash and accrual must never be summed. Pass basis to restrict.`,
    );
  }
  const layoutWarning = duplicateLayoutWarning(rows);
  if (layoutWarning) {
    warnings.push(layoutWarning);
  }

  const nextOffset = offset + rows.length < totalRows ? offset + rows.length : null;

  return {
    report: args.report,
    total_rows: totalRows,
    offset,
    limit,
    next_offset: nextOffset,
    properties,
    periods,
    bases,
    warnings,
    rows,
  };
}
