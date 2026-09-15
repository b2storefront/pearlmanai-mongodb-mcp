import type { Document } from "mongodb";

import {
  REPORT_COLLECTIONS,
  REPORT_TYPES,
  requireProperty,
  type AccountingBasis,
  type ReportType,
} from "../catalog.js";
import { propertyDb } from "../db.js";

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
  basis?: AccountingBasis;
  layout?: "mri" | "appfolio" | "essex";
  offset?: number;
  limit?: number;
}

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as string[]).includes(value);
}

function cellString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

function flattenTables(doc: Document): {
  header_text: string;
  tables: { keys: string[]; rows: Record<string, string>[] }[];
  rows: {
    row_index: number;
    table_index: number;
    label: string;
    cells: string[];
    columns: Record<string, string>;
  }[];
} {
  const segments = Array.isArray(doc.content?.segments) ? doc.content.segments : [];
  const textParts: string[] = [];
  const tables: { keys: string[]; rows: Record<string, string>[] }[] = [];
  const rows: {
    row_index: number;
    table_index: number;
    label: string;
    cells: string[];
    columns: Record<string, string>;
  }[] = [];

  for (const segment of segments) {
    if (segment?.kind === "text" && typeof segment.text === "string" && segment.text.trim()) {
      textParts.push(segment.text.trim());
      continue;
    }
    if (segment?.kind !== "table" || !Array.isArray(segment.rows)) {
      continue;
    }
    const tableIndex = tables.length;
    const mapped = (segment.rows as Document[]).map((row) => {
      const columns: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        columns[key] = cellString(value);
      }
      return columns;
    });
    const keys = mapped[0] ? Object.keys(mapped[0]) : [];
    tables.push({ keys, rows: mapped });
    for (const columns of mapped) {
      const cells = keys.map((key) => columns[key] ?? "");
      rows.push({
        row_index: rows.length,
        table_index: tableIndex,
        label: cells[0] ?? "",
        cells,
        columns,
      });
    }
  }

  return {
    header_text: textParts.join("\n\n"),
    tables: tables.map((table) => ({ keys: table.keys, rows: [] })),
    rows,
  };
}

function catalogBasis(property: ReturnType<typeof requireProperty>, period: string): AccountingBasis | undefined {
  const year = period.slice(0, 4);
  return property.basis_by_year[year];
}

export async function getReport(args: GetReportArgs) {
  const property = requireProperty(args.property_id);
  if (!isReportType(args.report)) {
    throw new ReportLookupError(
      `Unknown report "${args.report}". Use one of: ${REPORT_TYPES.join(", ")}.`,
    );
  }

  const period = args.period ?? args.as_of;
  if (!period) {
    throw new ReportLookupError(`${args.report} requires period (YYYY-MM).`);
  }

  const collectionName = REPORT_COLLECTIONS[args.report];
  const document = await propertyDb(property.mongo_db).collection(collectionName).findOne({
    reportMonth: period,
  });
  if (!document) {
    throw new ReportLookupError(
      `No ${args.report} for ${property._id} ${period} in ${property.mongo_db}.${collectionName}`,
    );
  }

  const flattened = flattenTables(document);
  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
  const page = flattened.rows.slice(offset, offset + limit);
  const nextOffset = offset + page.length < flattened.rows.length ? offset + page.length : null;
  const expectedBasis = catalogBasis(property, period);

  return {
    property_id: property._id,
    property_name: property.name,
    manager: property.manager,
    mongo_db: property.mongo_db,
    report: args.report,
    collection: collectionName,
    period,
    source_file: document.sourceFile,
    classification: document.classification,
    pages: document.pages,
    catalog_basis: expectedBasis,
    requested_basis: args.basis ?? null,
    header_text: flattened.header_text,
    table_count: flattened.tables.length,
    column_keys: flattened.tables[0]?.keys ?? [],
    total_rows: flattened.rows.length,
    offset,
    limit,
    next_offset: nextOffset,
    rows: page,
  };
}

export async function getSource(args: {
  property_id: string;
  report: ReportType;
  period?: string;
  as_of?: string;
  basis?: AccountingBasis;
  layout?: string;
}) {
  const property = requireProperty(args.property_id);
  const period = args.period ?? args.as_of;
  if (!period) {
    throw new ReportLookupError(`${args.report} requires period (YYYY-MM).`);
  }

  const collectionName = REPORT_COLLECTIONS[args.report];
  const document = await propertyDb(property.mongo_db).collection(collectionName).findOne({
    reportMonth: period,
  });
  if (!document) {
    throw new ReportLookupError(
      `No source for ${property._id} ${args.report} ${period} in ${property.mongo_db}.${collectionName}`,
    );
  }

  const segments = Array.isArray(document.content?.segments) ? document.content.segments : [];
  const markdown = segments
    .filter((segment: Document) => segment?.kind === "text" && typeof segment.text === "string")
    .map((segment: Document) => segment.text as string)
    .join("\n\n");

  return {
    property_id: property._id,
    report: args.report,
    collection: collectionName,
    period: document.reportMonth,
    source_file: document.sourceFile,
    classification: document.classification,
    pages: document.pages,
    imported_at: document.importedAt,
    markdown,
  };
}
