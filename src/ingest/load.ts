import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { Db, ObjectId } from "mongodb";

import { parseFilename } from "./filename.js";
import { parseReport, suspiciousLabel, type ParsedDocument } from "./parse.js";
import type { ReportType } from "../catalog.js";

export interface LandingAiFile {
  markdown: string;
  metadata?: {
    job_id?: string;
    model_version?: string;
    page_count?: number;
    billing?: { total_credits?: number };
  };
}

export interface IngestOptions {
  src: string;
  property?: string;
  report?: string;
  dryRun?: boolean;
}

export interface IngestSummary {
  loaded: number;
  skipped: { file: string; reason: string }[];
  failed: { file: string; error: string }[];
  documentsByReport: Record<string, number>;
  rowsByReport: Record<string, number>;
  labelHasValue: { report: string; count: number; examples: string[] };
  suspiciousLabels: string[];
}

interface SourceFile {
  path: string;
  filename: string;
  folderName: string;
}

function listSourceFiles(src: string): SourceFile[] {
  const files: SourceFile[] = [];

  function findFolders(dir: string, depth: number): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.name.endsWith("-splitted")) {
        found.push(full);
      } else if (depth < 2) {
        found.push(...findFolders(full, depth + 1));
      }
    }
    return found;
  }

  const roots = findFolders(src, 0);
  const folders = roots.length > 0 ? roots : [src];

  for (const folder of folders) {
    const folderName = basename(folder);
    const names = readdirSync(folder);
    const jsonNames = new Set(names.filter((name) => name.endsWith(".json")));
    for (const name of names) {
      if (name.endsWith(".json")) {
        files.push({ path: join(folder, name), filename: name, folderName });
      } else if (name.endsWith(".md") && !jsonNames.has(name.replace(/\.md$/i, ".json"))) {
        files.push({ path: join(folder, name), filename: name, folderName });
      }
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function loadLandingAi(path: string): LandingAiFile {
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LandingAiFile & {
      structure?: unknown;
    };
    delete parsed.structure;
    if (!parsed.markdown) {
      throw new Error(`JSON has no markdown: ${path}`);
    }
    return parsed;
  }
  return { markdown: readFileSync(path, "utf8") };
}

export function parseSourceFile(file: SourceFile): {
  parsed: ParsedDocument | "skip";
  identityReportName: string;
} {
  const identity = parseFilename(file.filename, file.folderName);
  const pdfName = file.filename.replace(/\.(md|json)$/i, ".pdf");
  const pdfPath = join(dirname(file.path), pdfName);
  if (existsSync(pdfPath)) {
    identity.sourcePdf = pdfName;
  }

  if (identity.report === "skip") {
    return { parsed: "skip", identityReportName: identity.reportName };
  }

  const source = loadLandingAi(file.path);
  const parsed = parseReport(source.markdown, identity);
  return { parsed, identityReportName: identity.reportName };
}

function contentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

export async function ingest(db: Db | null, options: IngestOptions): Promise<IngestSummary> {
  const files = listSourceFiles(options.src);
  const summary: IngestSummary = {
    loaded: 0,
    skipped: [],
    failed: [],
    documentsByReport: {},
    rowsByReport: {},
    labelHasValue: { report: "all", count: 0, examples: [] },
    suspiciousLabels: [],
  };

  for (const file of files) {
    try {
      const identity = parseFilename(file.filename, file.folderName);
      if (options.property && identity.property._id !== options.property) {
        continue;
      }
      if (identity.report === "skip") {
        summary.skipped.push({
          file: file.filename,
          reason: `${identity.reportName} is out of scope for now`,
        });
        continue;
      }
      if (options.report && identity.report !== options.report) {
        continue;
      }

      const source = loadLandingAi(file.path);
      const parsed = parseReport(source.markdown, identity);
      const hash = contentHash(source.markdown);
      const report = identity.report as ReportType;

      for (const row of parsed.rows) {
        if (row.label_has_value) {
          summary.labelHasValue.count += 1;
          if (summary.labelHasValue.examples.length < 12) {
            summary.labelHasValue.examples.push(
              `${identity.property._id} ${identity.period} ${row.label}`,
            );
          }
        }
        if (suspiciousLabel(row.label) && summary.suspiciousLabels.length < 80) {
          summary.suspiciousLabels.push(
            `${identity.property._id} ${report} ${identity.period}: ${row.label}`,
          );
        }
      }

      summary.documentsByReport[report] =
        (summary.documentsByReport[report] ?? 0) + 1;
      summary.rowsByReport[report] =
        (summary.rowsByReport[report] ?? 0) + parsed.rows.length;

      if (options.dryRun) {
        summary.loaded += 1;
        continue;
      }

      if (!db) {
        throw new Error("MongoDB connection required unless --dry-run");
      }

      const pdfName = file.filename.replace(/\.(md|json)$/i, ".pdf");
      const pdfPath = join(dirname(file.path), pdfName);

      const doc = {
        property_id: identity.property._id,
        manager: identity.property.manager,
        report,
        basis: parsed.basis,
        period: report === "forecast_budget_report" ? null : identity.period,
        as_of: identity.period,
        layout: identity.layout ?? null,
        source_file: identity.sourceFile,
        source_pdf: existsSync(pdfPath) ? pdfName : null,
        page_count: source.metadata?.page_count ?? null,
        column_headers: parsed.columnHeaders,
        header_text: parsed.headerText,
        markdown: source.markdown,
        landingai: {
          job_id: source.metadata?.job_id ?? null,
          model_version: source.metadata?.model_version ?? null,
          credits: source.metadata?.billing?.total_credits ?? null,
        },
        content_hash: hash,
        ingested_at: new Date(),
        row_count: parsed.rows.length,
      };

      const existing = await db.collection("documents").findOne({
        source_file: identity.sourceFile,
      });

      if (existing && existing.content_hash === hash) {
        summary.loaded += 1;
        continue;
      }

      const result = await db.collection("documents").findOneAndUpdate(
        { source_file: identity.sourceFile },
        { $set: doc },
        { upsert: true, returnDocument: "after" },
      );
      const documentId = (result?._id ?? existing?._id) as ObjectId;

      await db.collection(report).deleteMany({ document_id: documentId });
      if (parsed.rows.length > 0) {
        await db.collection(report).insertMany(
          parsed.rows.map((row) => ({
            ...row,
            document_id: documentId,
          })),
        );
      }

      summary.loaded += 1;
    } catch (error) {
      summary.failed.push({
        file: file.filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

export function printSummary(summary: IngestSummary): void {
  console.log("\nIngest summary");
  console.log(`  loaded: ${summary.loaded}`);
  console.log("  documents by report:", summary.documentsByReport);
  console.log("  rows by report:", summary.rowsByReport);
  console.log(
    `  label_has_value: ${summary.labelHasValue.count} (examples: ${summary.labelHasValue.examples.slice(0, 5).join(" | ")})`,
  );
  console.log(`  skipped: ${summary.skipped.length}`);
  for (const skip of summary.skipped) {
    console.log(`    - ${skip.file}: ${skip.reason}`);
  }
  console.log(`  failed: ${summary.failed.length}`);
  for (const fail of summary.failed) {
    console.log(`    - ${fail.file}: ${fail.error}`);
  }
  if (summary.suspiciousLabels.length) {
    console.log("  suspicious labels (feed for upstream OCR rules, not rewritten):");
    for (const label of summary.suspiciousLabels.slice(0, 40)) {
      console.log(`    - ${label}`);
    }
  }
}
