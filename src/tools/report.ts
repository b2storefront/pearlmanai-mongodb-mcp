import type { Db, Document } from "mongodb";

import { REPORT_TYPES, requireProperty, type ReportType } from "../catalog.js";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

export class ReportLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportLookupError";
  }
}

export interface GetReportArgs {
  property_id: string;
  report: ReportType;
  period?: string;
  as_of?: string;
  basis: "accrual" | "cash";
  layout?: "mri" | "appfolio" | "essex";
  offset?: number;
  limit?: number;
}

export interface GetYearReportArgs {
  property_id: string;
  report: ReportType;
  year: string | number;
  basis: "accrual" | "cash";
  layout?: "mri" | "appfolio" | "essex";
  offset?: number;
  limit?: number;
}

const YEAR_RE = /^\d{4}$/;

function calendarMonths(year: string): string[] {
  return Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
}

function documentMonth(doc: Document, report: ReportType): string {
  const value =
    report === "forecast_budget_report" ? doc.as_of : (doc.period ?? doc.as_of);
  return typeof value === "string" ? value : "";
}

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as string[]).includes(value);
}

export async function getReport(db: Db, args: GetReportArgs) {
  const property = requireProperty(args.property_id);
  if (!isReportType(args.report)) {
    throw new ReportLookupError(
      `Unknown report "${args.report}". Use one of: ${REPORT_TYPES.join(", ")}.`,
    );
  }

  const asOf = args.as_of ?? args.period;
  const period = args.period ?? args.as_of;
  if (args.report === "forecast_budget_report") {
    if (!asOf) {
      throw new ReportLookupError("forecast_budget_report requires as_of (or period).");
    }
  } else if (!period) {
    throw new ReportLookupError(`${args.report} requires period.`);
  }

  const filter: Document =
    args.report === "forecast_budget_report"
      ? { property_id: property._id, report: args.report, basis: args.basis, as_of: asOf }
      : { property_id: property._id, report: args.report, basis: args.basis, period };

  if (args.report === "income_statement") {
    const matches = await db
      .collection("documents")
      .find(filter, { projection: { layout: 1, source_file: 1, row_count: 1 } })
      .toArray();
    const layouts = [...new Set(matches.map((doc) => doc.layout).filter(Boolean))];
    if (!args.layout && layouts.length > 1) {
      throw new ReportLookupError(
        `${property._id} ${period} has ${layouts.length} income statements (${layouts.join(", ")}). Pass layout to pick one; do not add both.`,
      );
    }
    if (args.layout) {
      filter.layout = args.layout;
    }
  } else if (args.layout) {
    filter.layout = args.layout;
  }

  const document = await db.collection("documents").findOne(filter);
  if (!document) {
    throw new ReportLookupError(
      `No ${args.report} for ${property._id} ${period ?? asOf} ${args.basis}` +
        (args.layout ? ` layout=${args.layout}` : ""),
    );
  }

  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
  const totalRows = await db.collection(args.report).countDocuments({
    document_id: document._id,
  });
  const rows = await db
    .collection(args.report)
    .find({ document_id: document._id })
    .sort({ document_id: 1, row_index: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  const nextOffset = offset + rows.length < totalRows ? offset + rows.length : null;

  return {
    property_id: property._id,
    property_name: property.name,
    manager: property.manager,
    report: args.report,
    basis: document.basis,
    period: document.period,
    as_of: document.as_of,
    layout: document.layout,
    source_file: document.source_file,
    header_text: document.header_text,
    column_headers: document.column_headers,
    total_rows: totalRows,
    offset,
    limit,
    next_offset: nextOffset,
    rows,
  };
}

export async function getYearReport(db: Db, args: GetYearReportArgs) {
  const property = requireProperty(args.property_id);
  if (!isReportType(args.report)) {
    throw new ReportLookupError(
      `Unknown report "${args.report}". Use one of: ${REPORT_TYPES.join(", ")}.`,
    );
  }

  const year = String(args.year ?? "").trim();
  if (!YEAR_RE.test(year)) {
    throw new ReportLookupError(`year must be YYYY (for example 2024), not "${args.year}".`);
  }

  const dateField = args.report === "forecast_budget_report" ? "as_of" : "period";
  const filter: Document = {
    property_id: property._id,
    report: args.report,
    basis: args.basis,
    [dateField]: { $gte: `${year}-01`, $lte: `${year}-12` },
  };

  const matches = await db
    .collection("documents")
    .find(filter, {
      projection: {
        layout: 1,
        period: 1,
        as_of: 1,
        source_file: 1,
        row_count: 1,
      },
    })
    .toArray();

  if (args.report === "income_statement" && !args.layout) {
    const layoutsByMonth = new Map<string, Set<string>>();
    for (const doc of matches) {
      const month = documentMonth(doc, args.report);
      const layouts = layoutsByMonth.get(month) ?? new Set<string>();
      if (typeof doc.layout === "string" && doc.layout) {
        layouts.add(doc.layout);
      }
      layoutsByMonth.set(month, layouts);
    }
    const overlaps = [...layoutsByMonth.entries()].filter(
      ([, layouts]) => layouts.size > 1,
    );
    if (overlaps.length > 0) {
      const layouts = [...overlaps[0][1]].sort();
      throw new ReportLookupError(
        `${property._id} ${year} has ${layouts.length} income statements (${layouts.join(", ")}). Pass layout to pick one; do not add both.`,
      );
    }
  }
  if (args.layout) {
    filter.layout = args.layout;
  }

  const documents = await db
    .collection("documents")
    .find(filter)
    .sort({ [dateField]: 1, layout: 1 })
    .toArray();

  const present = [
    ...new Set(documents.map((doc) => documentMonth(doc, args.report)).filter(Boolean)),
  ].sort();
  const missing = calendarMonths(year).filter((month) => !present.includes(month));

  if (documents.length === 0) {
    throw new ReportLookupError(
      `No ${args.report} for ${property._id} ${year} ${args.basis}` +
        (args.layout ? ` layout=${args.layout}` : ""),
    );
  }

  const defaultMonthLimit = args.report === "general_ledger" ? 1 : 12;
  const monthOffset = Math.max(0, args.offset ?? 0);
  const monthLimit = Math.min(12, Math.max(1, args.limit ?? defaultMonthLimit));
  const pageDocs = documents.slice(monthOffset, monthOffset + monthLimit);
  const nextOffset =
    monthOffset + pageDocs.length < documents.length
      ? monthOffset + pageDocs.length
      : null;

  const ids = pageDocs.map((doc) => doc._id);
  const rowCap = args.report === "general_ledger" ? DEFAULT_LIMIT : MAX_LIMIT;
  const allRows = ids.length
    ? await db
        .collection(args.report)
        .find({ document_id: { $in: ids } })
        .sort({ document_id: 1, row_index: 1 })
        .toArray()
    : [];

  const rowsByDocument = new Map<string, Document[]>();
  for (const row of allRows) {
    const key = String(row.document_id);
    const list = rowsByDocument.get(key) ?? [];
    list.push(row);
    rowsByDocument.set(key, list);
  }

  const reports = pageDocs.map((document) => {
    const rows = rowsByDocument.get(String(document._id)) ?? [];
    const truncated = args.report === "general_ledger" && rows.length > rowCap;
    return {
      period: document.period,
      as_of: document.as_of,
      layout: document.layout,
      source_file: document.source_file,
      header_text: document.header_text,
      column_headers: document.column_headers,
      total_rows: Number(document.row_count ?? rows.length),
      rows: truncated ? rows.slice(0, rowCap) : rows,
    };
  });

  return {
    property_id: property._id,
    property_name: property.name,
    manager: property.manager,
    report: args.report,
    basis: args.basis,
    year,
    layout: args.layout,
    periods: present,
    missing_periods: missing,
    offset: monthOffset,
    limit: monthLimit,
    next_offset: nextOffset,
    reports,
  };
}

export async function getSource(
  db: Db,
  args: { property_id: string; report: ReportType; period?: string; as_of?: string; basis: "accrual" | "cash"; layout?: string },
) {
  const property = requireProperty(args.property_id);
  const asOf = args.as_of ?? args.period;
  const period = args.period ?? args.as_of;
  const filter: Document =
    args.report === "forecast_budget_report"
      ? { property_id: property._id, report: args.report, basis: args.basis, as_of: asOf }
      : { property_id: property._id, report: args.report, basis: args.basis, period };
  if (args.layout) {
    filter.layout = args.layout;
  }

  const matches = await db.collection("documents").find(filter).toArray();
  if (args.report === "income_statement" && !args.layout && matches.length > 1) {
    throw new ReportLookupError(
      `${property._id} ${period} has multiple income statements. Pass layout.`,
    );
  }
  const document = matches[0];
  if (!document) {
    throw new ReportLookupError(
      `No source for ${property._id} ${args.report} ${period ?? asOf} ${args.basis}`,
    );
  }

  return {
    property_id: property._id,
    report: document.report,
    basis: document.basis,
    period: document.period,
    as_of: document.as_of,
    layout: document.layout,
    source_file: document.source_file,
    source_pdf: document.source_pdf,
    page_count: document.page_count,
    column_headers: document.column_headers,
    landingai: document.landingai,
    content_hash: document.content_hash,
    ingested_at: document.ingested_at,
    markdown: document.markdown,
  };
}
