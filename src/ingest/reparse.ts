import "dotenv/config";

import type { Db, Document, ObjectId } from "mongodb";

import { closeDb, connectDb } from "../db.js";
import { loadConfig } from "../config.js";
import { REPORT_TYPES, type ReportType } from "../catalog.js";
import { identityFromStoredDocument } from "./filename.js";
import { parseReport, type ParsedDocument, type ParsedRow } from "./parse.js";
import {
  addSplitCounts,
  applyIncomeStatementMetadata,
  buildNameCodeIndex,
  emptySplitCounts,
  looksFused,
  mergeNameCodeIndexes,
  uniqueCodesOnly,
  type NameCodeIndex,
  type RepairableRow,
  type SplitCounts,
} from "./repair.js";

export interface ReparseOptions {
  report: ReportType;
  property?: string;
  dryRun?: boolean;
}

export interface ReparseSummary {
  documents: number;
  rowsBefore: number;
  rowsAfter: number;
  splitCounts: SplitCounts;
  backfillAssigned: number;
  remainingFused: { before: number; after: number; examples: string[] };
  suspects: { count: number; examples: string[] };
  rowKind: Record<string, number>;
  midLabelAccountCodes: number;
  failed: { file: string; error: string }[];
}

interface StoredDocument extends Document {
  _id: ObjectId;
  property_id: string;
  report: ReportType;
  basis: "accrual" | "cash";
  period?: string | null;
  as_of?: string | null;
  layout?: "mri" | "appfolio" | "essex" | null;
  source_file: string;
  markdown: string;
  row_count?: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as string[]).includes(value);
}

async function loadStoredCodedRows(db: Db, report: ReportType): Promise<RepairableRow[]> {
  const rows = await db
    .collection(report)
    .find({ account_code: { $type: "string", $ne: "" } })
    .project({
      property_id: 1,
      period: 1,
      label: 1,
      account_code: 1,
      canonical_label: 1,
      cells: 1,
    })
    .toArray();

  return rows.map((row) => ({
    property_id: String(row.property_id ?? ""),
    period: typeof row.period === "string" ? row.period : null,
    label: String(row.label ?? ""),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => String(cell)) : [],
    account_code: typeof row.account_code === "string" ? row.account_code : undefined,
    canonical_label: typeof row.canonical_label === "string" ? row.canonical_label : undefined,
  }));
}

export async function reparse(db: Db, options: ReparseOptions): Promise<ReparseSummary> {
  const filter: Document = { report: options.report };
  if (options.property) {
    filter.property_id = options.property;
  }

  const documents = (await db
    .collection("documents")
    .find(filter)
    .sort({ property_id: 1, period: 1, source_file: 1 })
    .toArray()) as StoredDocument[];

  const summary: ReparseSummary = {
    documents: 0,
    rowsBefore: 0,
    rowsAfter: 0,
    splitCounts: emptySplitCounts(),
    backfillAssigned: 0,
    remainingFused: { before: 0, after: 0, examples: [] },
    suspects: { count: 0, examples: [] },
    rowKind: {},
    midLabelAccountCodes: 0,
    failed: [],
  };

  const parsedByProperty = new Map<
    string,
    Array<{ stored: StoredDocument; parsed: ParsedDocument; existing: ParsedRow[] }>
  >();

  for (const stored of documents) {
    try {
      const identity = identityFromStoredDocument(stored);
      const parsed = parseReport(stored.markdown, identity);
      const existing = (await db
        .collection(options.report)
        .find({ document_id: stored._id })
        .sort({ row_index: 1 })
        .toArray()) as ParsedRow[];

      summary.documents += 1;
      summary.rowsBefore += existing.length;
      if (parsed.splitCounts) {
        addSplitCounts(summary.splitCounts, parsed.splitCounts);
      }

      for (const row of existing) {
        if (looksFused(row.label)) {
          summary.remainingFused.before += 1;
        }
      }

      const group = parsedByProperty.get(stored.property_id) ?? [];
      group.push({ stored, parsed, existing });
      parsedByProperty.set(stored.property_id, group);
    } catch (error) {
      summary.failed.push({
        file: stored.source_file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const parsedIndex: NameCodeIndex = new Map();
  for (const group of parsedByProperty.values()) {
    for (const item of group) {
      mergeNameCodeIndexes(parsedIndex, buildNameCodeIndex(item.parsed.rows));
    }
  }
  const storedIndex =
    options.report === "income_statement"
      ? buildNameCodeIndex(await loadStoredCodedRows(db, options.report))
      : new Map();
  const globalUnique = uniqueCodesOnly(mergeNameCodeIndexes(storedIndex, parsedIndex));

  for (const [, group] of parsedByProperty) {
    const layout = group[0]?.stored.layout ?? group[0]?.parsed.rows[0]?.layout;
    let index: NameCodeIndex = new Map();
    // AppFolio/Essex prints never include MRI account numbers. Do not copy
    // unique codes from other properties onto those statements.
    if (layout === "mri") {
      index = mergeNameCodeIndexes(index, globalUnique);
    }
    for (const item of group) {
      index = mergeNameCodeIndexes(index, buildNameCodeIndex(item.parsed.rows));
    }

    for (const item of group) {
      const backfill = applyIncomeStatementMetadata(item.parsed.rows, index);
      summary.backfillAssigned += backfill.assigned;
      summary.rowsAfter += item.parsed.rows.length;

      for (const row of item.parsed.rows) {
        const kind = row.row_kind ?? "suspect";
        summary.rowKind[kind] = (summary.rowKind[kind] ?? 0) + 1;
        if (kind === "suspect") {
          summary.suspects.count += 1;
          if (summary.suspects.examples.length < 20) {
            summary.suspects.examples.push(
              `${row.property_id} ${row.period ?? ""} ${row.label}`.trim(),
            );
          }
        }
        const fused = looksFused(row.label);
        if (fused) {
          summary.remainingFused.after += 1;
          if (summary.remainingFused.examples.length < 20) {
            summary.remainingFused.examples.push(
              `${fused}: ${row.property_id} ${row.period ?? ""} ${row.label}`,
            );
          }
        }
        if (/\b\d{3,5}-\d{4}\b/.test(row.label) && !/^\d{3,5}-\d{4}\b/.test(row.label.trim())) {
          summary.midLabelAccountCodes += 1;
        }
      }

      if (options.dryRun) {
        continue;
      }

      await db.collection(options.report).deleteMany({ document_id: item.stored._id });
      if (item.parsed.rows.length > 0) {
        await db.collection(options.report).insertMany(
          item.parsed.rows.map((row) => ({
            ...row,
            document_id: item.stored._id,
          })),
        );
      }
      await db.collection("documents").updateOne(
        { _id: item.stored._id },
        { $set: { row_count: item.parsed.rows.length, reparsed_at: new Date() } },
      );
    }
  }

  return summary;
}

export function printReparseSummary(summary: ReparseSummary): void {
  console.log("\nReparse summary");
  console.log(`  documents: ${summary.documents}`);
  console.log(`  rows before/after: ${summary.rowsBefore} → ${summary.rowsAfter}`);
  console.log("  splits:", summary.splitCounts);
  console.log(`  name→code backfill assigned: ${summary.backfillAssigned}`);
  console.log(
    `  fused labels remaining: ${summary.remainingFused.after} (was ${summary.remainingFused.before})`,
  );
  console.log(`  mid-label account codes: ${summary.midLabelAccountCodes}`);
  console.log("  row_kind:", summary.rowKind);
  console.log(`  suspects: ${summary.suspects.count}`);
  for (const example of summary.suspects.examples.slice(0, 12)) {
    console.log(`    - ${example}`);
  }
  if (summary.remainingFused.examples.length) {
    console.log("  remaining fused examples:");
    for (const example of summary.remainingFused.examples) {
      console.log(`    - ${example}`);
    }
  }
  console.log(`  failed: ${summary.failed.length}`);
  for (const fail of summary.failed) {
    console.log(`    - ${fail.file}: ${fail.error}`);
  }
}

async function main() {
  const reportArg = arg("report") ?? "income_statement";
  if (!isReportType(reportArg)) {
    console.error(
      `Usage: npm run reparse -- --report income_statement [--property X] [--dry-run]`,
    );
    process.exit(1);
  }

  const dryRun = flag("dry-run");
  const config = loadConfig();
  const db = await connectDb(config);
  const summary = await reparse(db, {
    report: reportArg,
    property: arg("property"),
    dryRun,
  });
  printReparseSummary(summary);
  if (dryRun) {
    console.log("\nDry run — no rows written.");
  }
  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
  await closeDb();
}

const isDirect = process.argv[1]?.includes("reparse");
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
