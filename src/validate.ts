import "dotenv/config";
import { closeDb, connectDb, getDb } from "./db.js";
import { loadConfig } from "./config.js";
import { getCoverage } from "./tools/coverage.js";
import { getReport, ReportLookupError } from "./tools/report.js";
import { searchLineItems } from "./tools/search.js";
import { ingest } from "./ingest/load.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function findRow(rows: unknown, pattern: RegExp) {
  return (rows as Array<Record<string, unknown>>).find(
    (row) => typeof row.label === "string" && pattern.test(row.label),
  );
}

async function main() {
  const src = arg("src");
  const checks: Check[] = [];

  if (src) {
    const summary = await ingest(null, { src, dryRun: true });
    const is = summary.documentsByReport.income_statement ?? 0;
    const bs = summary.documentsByReport.standard_balance_sheet ?? 0;
    const fc = summary.documentsByReport.forecast_budget_report ?? 0;
    const gl = summary.documentsByReport.general_ledger ?? 0;
    checks.push({
      name: "document counts",
      ok: is === 83 && bs === 75 && fc === 74 && gl === 74,
      detail: `IS ${is} BS ${bs} FC ${fc} GL ${gl} loaded ${summary.loaded} skipped ${summary.skipped.length} failed ${summary.failed.length}`,
    });
    checks.push({
      name: "cash flow skipped",
      ok: summary.skipped.length === 1 && /Cash Flow/.test(summary.skipped[0]?.file ?? ""),
      detail: summary.skipped.map((s) => `${s.file}: ${s.reason}`).join("; ") || "none",
    });
    checks.push({
      name: "nothing failed",
      ok: summary.failed.length === 0,
      detail: summary.failed.map((f) => `${f.file}: ${f.error}`).join("; ") || "none",
    });
    checks.push({
      name: "label_has_value in expected band",
      ok: summary.labelHasValue.count >= 250 && summary.labelHasValue.count <= 400,
      detail: String(summary.labelHasValue.count),
    });
  }

  const config = loadConfig();
  const db = await connectDb(config);
  const coverage = await getCoverage(db);
  const byReport = Object.fromEntries(coverage.byReport.map((row) => [row.report, row]));

  checks.push({
    name: "mongo document counts",
    ok:
      byReport.income_statement?.documents === 334 &&
      byReport.standard_balance_sheet?.documents === 327 &&
      byReport.forecast_budget_report?.documents === 326 &&
      byReport.general_ledger?.documents === 324,
    detail: coverage.byReport
      .map((row) => `${row.report}:${row.documents}/${row.rows} rows`)
      .join(", "),
  });
  checks.push({
    name: "eleven properties",
    ok: coverage.byProperty.filter((p) => p.reports.length > 0).length === 11,
    detail: coverage.byProperty.map((p) => p.property_id).join(","),
  });
  checks.push({
    name: "get_coverage has row counts",
    ok: coverage.byReport.every((row) => row.rows > 0),
    detail: coverage.byReport.map((row) => `${row.report}:${row.rows}`).join(", "),
  });

  const timbers = await getReport(db, {
    property_id: "Timbers",
    report: "income_statement",
    period: "2026-04",
    basis: "cash",
  });
  const timbersNoi = findRow(timbers.rows, /net operating/i) as
    | { month?: number; ytd?: number; label: string }
    | undefined;
  const timbersNi = findRow(timbers.rows, /^net income/i) as
    | { month?: number; label: string }
    | undefined;
  checks.push({
    name: "Timbers 2026-04 cash NOI",
    ok:
      timbersNoi?.month === -3979.83 &&
      timbersNoi?.ytd === 186544.55,
    detail: `${timbersNoi?.label} month=${timbersNoi?.month} ytd=${timbersNoi?.ytd}`,
  });
  checks.push({
    name: "Timbers 2026-04 net income",
    ok: timbersNi?.month === -8367.25,
    detail: `${timbersNi?.label} month=${timbersNi?.month}`,
  });

  const broadway = await getReport(db, {
    property_id: "1050",
    report: "income_statement",
    period: "2026-04",
    basis: "accrual",
  });
  const broadwayNoi = findRow(broadway.rows, /net operating/i) as
    | { month?: number; ytd?: number }
    | undefined;
  const fee = findRow(broadway.rows, /5755-0000/) as
    | { month?: number; budget?: number; label: string }
    | undefined;
  checks.push({
    name: "1050 2026-04 accrual NOI",
    ok: broadwayNoi?.month === 85966.24 && broadwayNoi?.ytd === 504542.24,
    detail: `month=${broadwayNoi?.month} ytd=${broadwayNoi?.ytd}`,
  });
  checks.push({
    name: "1050 management fee vs budget",
    ok: fee?.month === 750 && fee?.budget === 500,
    detail: `${fee?.label} actual=${fee?.month} budget=${fee?.budget}`,
  });

  const fused = broadway.rows.find((row) =>
    /OPERATING INCOME RENT INCOME/.test(row.label),
  );
  const operatingIncome = broadway.rows.find((row) =>
    /^OPERATING INCOME$/.test(row.label),
  );
  const rentIncome = broadway.rows.find((row) => /^RENT INCOME$/.test(row.label));
  checks.push({
    name: "1050 fused heading is split",
    ok: !fused && Boolean(operatingIncome) && Boolean(rentIncome),
    detail: fused?.label ?? `split: ${operatingIncome?.label} + ${rentIncome?.label}`,
  });
  checks.push({
    name: "income statement returned whole",
    ok: broadway.total_rows === broadway.rows.length && broadway.next_offset === null,
    detail: `rows=${broadway.rows.length} total=${broadway.total_rows}`,
  });

  const noiSearch = await searchLineItems(db, {
    report: "income_statement",
    label: "net operating",
    period: "2026-04",
    basis: "accrual",
    layout: "mri",
  });
  const search1050 = noiSearch.rows.find((row) => row.property_id === "1050") as
    | { month?: number; ytd?: number; label?: string }
    | undefined;
  checks.push({
    name: "search_line_items April accrual NOI",
    ok:
      noiSearch.total_rows >= 8 &&
      search1050?.month === 85966.24 &&
      search1050?.ytd === 504542.24,
    detail: `total=${noiSearch.total_rows} properties=${noiSearch.properties.length} 1050=${search1050?.month}/${search1050?.ytd}`,
  });

  let ambiguous = false;
  try {
    await getReport(db, {
      property_id: "9810",
      report: "income_statement",
      period: "2026-07",
      basis: "accrual",
    });
  } catch (error) {
    ambiguous = error instanceof ReportLookupError && /layout/.test(error.message);
  }
  checks.push({
    name: "9810 without layout is ambiguous",
    ok: ambiguous,
    detail: ambiguous ? "rejected" : "not rejected",
  });

  const mri = await getReport(db, {
    property_id: "9810",
    report: "income_statement",
    period: "2026-07",
    basis: "accrual",
    layout: "mri",
  });
  const essex = await getReport(db, {
    property_id: "9810",
    report: "income_statement",
    period: "2026-07",
    basis: "accrual",
    layout: "essex",
  });
  const mriNoi = findRow(mri.rows, /net operating/i) as { month?: number; ytd?: number } | undefined;
  const essexNoi = findRow(essex.rows, /net operating/i) as { month?: number; ytd?: number } | undefined;
  checks.push({
    name: "9810 both layouts agree on NOI",
    ok:
      mriNoi?.month === 226234.22 &&
      mriNoi?.ytd === 1429213.44 &&
      essexNoi?.month === 226234.22 &&
      essexNoi?.ytd === 1429213.44,
    detail: `mri ${mriNoi?.month}/${mriNoi?.ytd} essex ${essexNoi?.month}/${essexNoi?.ytd}`,
  });

  const bs = await getReport(db, {
    property_id: "Timbers",
    report: "standard_balance_sheet",
    period: "2026-04",
    basis: "cash",
  });
  const assets = findRow(bs.rows, /^total assets$/i) as { balance?: number } | undefined;
  const liab = findRow(bs.rows, /total liabilities\s*(&|and)\s*capital/i) as { balance?: number } | undefined;
  checks.push({
    name: "Timbers BS balances",
    ok: assets?.balance === 2874561.55 && liab?.balance === 2874561.55,
    detail: `assets=${assets?.balance} liab=${liab?.balance} label=${liab && (liab as { label?: string }).label}`,
  });

  const forecast = await getReport(db, {
    property_id: "1050",
    report: "forecast_budget_report",
    as_of: "2026-04",
    basis: "accrual",
  });
  const rent = forecast.rows.find((row) => /commercial rent/i.test(row.label)) as
    | {
        months?: Record<string, { amount: number | null; kind: string }>;
        total_forecast?: number | null;
        label: string;
      }
    | undefined;
  checks.push({
    name: "1050 forecast Commercial Rent",
    ok:
      rent?.months?.["2026-01"]?.kind === "actual" &&
      rent?.months?.["2026-09"]?.kind === "budget" &&
      rent?.total_forecast === 1821160,
    detail: `${rent?.label} jan=${JSON.stringify(rent?.months?.["2026-01"])} sep=${JSON.stringify(rent?.months?.["2026-09"])} total=${rent?.total_forecast}`,
  });

  const gl = await getReport(db, {
    property_id: "Timbers",
    report: "general_ledger",
    period: "2026-04",
    basis: "cash",
    limit: 200,
  });
  const page2 = await getReport(db, {
    property_id: "Timbers",
    report: "general_ledger",
    period: "2026-04",
    basis: "cash",
    offset: 200,
    limit: 200,
  });
  const overlap = gl.rows.some((row) =>
    page2.rows.some((other) => other.row_index === row.row_index),
  );
  checks.push({
    name: "GL paging no overlap",
    ok: !overlap && gl.total_rows > 200 && gl.next_offset === 200,
    detail: `total=${gl.total_rows} p1=${gl.rows.length} p2=${page2.rows.length} next=${gl.next_offset}`,
  });

  const june530 = await getReport(db, {
    property_id: "530",
    report: "forecast_budget_report",
    as_of: "2026-06",
    basis: "accrual",
  });
  checks.push({
    name: "530 Jun forecast has no NOI row",
    ok: !june530.rows.some((row) => /net operating|\bnoi\b/i.test(row.label)),
    detail: "absent as in source",
  });

  const corbettFc = await getReport(db, {
    property_id: "Corbett",
    report: "forecast_budget_report",
    as_of: "2026-04",
    basis: "cash",
  });
  const damaged = corbettFc.rows.find((row) => /imcome/i.test(row.label));
  checks.push({
    name: "Corbett Imcome reproduced not rewritten",
    ok: Boolean(damaged),
    detail: damaged?.label ?? "missing",
  });

  const shifted = await getDb()
    .collection("forecast_budget_report")
    .countDocuments({ label_has_value: true });
  const shiftedGl = await getDb()
    .collection("general_ledger")
    .countDocuments({ label_has_value: true });
  const shiftedIs = await getDb()
    .collection("income_statement")
    .countDocuments({ label_has_value: true });
  checks.push({
    name: "label_has_value counts",
    ok: shifted >= 250 && shiftedGl >= 10 && shiftedIs === 0,
    detail: `forecast=${shifted} gl=${shiftedGl} is=${shiftedIs}`,
  });

  const midLabel = await getDb()
    .collection("income_statement")
    .countDocuments({
      $and: [
        { label: { $regex: "\\d{3,5}-\\d{4}" } },
        { label: { $not: { $regex: "^\\d{3,5}-\\d{4}" } } },
      ],
    });
  checks.push({
    name: "no mid-label account codes",
    ok: midLabel === 0,
    detail: String(midLabel),
  });

  const missingKind = await getDb()
    .collection("income_statement")
    .countDocuments({ row_kind: { $exists: false } });
  const suspectCount = await getDb()
    .collection("income_statement")
    .countDocuments({ row_kind: "suspect" });
  const kindCounts = await getDb()
    .collection("income_statement")
    .aggregate([{ $group: { _id: "$row_kind", n: { $sum: 1 } } }])
    .toArray();
  checks.push({
    name: "row_kind coverage",
    ok: missingKind === 0 && suspectCount < 100,
    detail: `missing=${missingKind} suspects=${suspectCount} ${kindCounts.map((row) => `${row._id}:${row.n}`).join(",")}`,
  });

  await closeDb();

  let failed = 0;
  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    if (!check.ok) {
      failed += 1;
    }
    console.log(`${mark}  ${check.name} — ${check.detail}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
