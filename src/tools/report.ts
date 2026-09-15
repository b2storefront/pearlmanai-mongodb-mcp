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
