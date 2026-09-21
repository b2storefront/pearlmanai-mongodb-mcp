import type { AccountingBasis, IncomeLayout, ReportType } from "../catalog.js";
import { extractAccountCode, labelHasValue, parseAmount } from "./amounts.js";
import { parseBasisFromText, type FileIdentity } from "./filename.js";
import { parseBlocks, type TableRow } from "./html.js";
import {
  addSplitCounts,
  applyIncomeStatementMetadata,
  emptySplitCounts,
  splitIncomeStatementLabel,
  type RowKind,
  type SplitCounts,
} from "./repair.js";

export interface MonthAmount {
  amount: number | null;
  kind: "actual" | "budget";
}

export interface ParsedRow {
  property_id: string;
  manager: string;
  basis: AccountingBasis;
  fiscal_year: number;
  period: string | null;
  as_of: string;
  label: string;
  cells: string[];
  account_code?: string;
  row_index: number;
  page: number;
  label_has_value: boolean;
  layout?: IncomeLayout;
  canonical_label?: string;
  row_kind?: RowKind;
  month?: number | null;
  ytd?: number | null;
  budget?: number | null;
  variance?: number | null;
  ytd_budget?: number | null;
  ytd_variance?: number | null;
  pct_month?: number | null;
  pct_ytd?: number | null;
  balance?: number | null;
  months?: Record<string, MonthAmount>;
  total_forecast?: number | null;
  total_budgeted?: number | null;
  account_name?: string;
  entry_date?: string;
  source_code?: string;
  reference?: string;
  description?: string;
  debit?: number | null;
  credit?: number | null;
}

export interface ParsedDocument {
  identity: FileIdentity;
  basis: AccountingBasis;
  headerText: string;
  columnHeaders: string[][];
  rows: ParsedRow[];
  flags: string[];
  splitCounts?: SplitCounts;
}

const MONTH_NAME: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthFromHeader(cell: string, year: number): string | undefined {
  const named = cell.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}|\d{2}))?/i,
  );
  if (!named) {
    return undefined;
  }
  const month = MONTH_NAME[named[1].toLowerCase()];
  if (!month) {
    return undefined;
  }
  let y = year;
  if (named[2]) {
    y = named[2].length === 2 ? 2000 + Number(named[2]) : Number(named[2]);
  }
  return `${y}-${String(month).padStart(2, "0")}`;
}

function kindFromHeader(cell: string): "actual" | "budget" | undefined {
  if (/actual/i.test(cell)) {
    return "actual";
  }
  if (/budget/i.test(cell)) {
    return "budget";
  }
  return undefined;
}

function parseActualBudgetRange(
  text: string,
): { actualThrough?: string; year?: number } {
  const match = text.match(
    /Actual amounts from\s+(\d{1,2})\/(\d{2})\s+to\s+(\d{1,2})\/(\d{2})/i,
  );
  if (!match) {
    return {};
  }
  const year = 2000 + Number(match[4]);
  const throughMonth = Number(match[3]);
  return {
    year,
    actualThrough: `${year}-${String(throughMonth).padStart(2, "0")}`,
  };
}

function looksLikeHeaderRow(row: TableRow): boolean {
  const joined = row.cells.join(" ").toLowerCase();
  if (
    /account name|selected month|year to month|actual|budget \(std\)|ytd actual|jan 20|feb 20|entry date|payee/.test(
      joined,
    )
  ) {
    return true;
  }
  const hasAmount = row.cells.slice(1).some((cell) => parseAmount(cell) != null);
  return !hasAmount && row.cells.some((cell) => /actual|budget|jan|balance/i.test(cell));
}

function baseRow(
  identity: FileIdentity,
  basis: AccountingBasis,
  label: string,
  cells: string[],
  rowIndex: number,
  page: number,
  period: string | null,
): ParsedRow {
  const account = extractAccountCode(label);
  return {
    property_id: identity.property._id,
    manager: identity.property.manager,
    basis,
    fiscal_year: identity.fiscalYear,
    period,
    as_of: identity.period,
    label,
    cells,
    ...(account ? { account_code: account } : {}),
    row_index: rowIndex,
    page,
    label_has_value: labelHasValue(label),
  };
}

function applyIncomeMeasures(row: ParsedRow, layout: IncomeLayout): void {
  row.layout = layout;
  const c = row.cells;
  if (layout === "appfolio") {
    row.month = parseAmount(c[0]);
    row.pct_month = parseAmount(c[1]);
    row.ytd = parseAmount(c[2]);
    row.pct_ytd = parseAmount(c[3]);
    return;
  }
  if (layout === "essex") {
    row.month = parseAmount(c[0]);
    row.ytd = parseAmount(c[1]);
    return;
  }
  // mri: actual, budget, variance, pct, ytd, ytd_budget, ytd_variance, pct
  row.month = parseAmount(c[0]);
  row.budget = parseAmount(c[1]);
  row.variance = parseAmount(c[2]);
  row.ytd = parseAmount(c[4]);
  row.ytd_budget = parseAmount(c[5]);
  row.ytd_variance = parseAmount(c[6]);
}

function applyBalance(row: ParsedRow): void {
  const c = row.cells;
  row.balance = parseAmount(c[0]) ?? parseAmount(c[1]);
}

function applyForecast(
  row: ParsedRow,
  monthColumns: { index: number; period: string; kind: "actual" | "budget" }[],
  totalForecastIndex: number | undefined,
  totalBudgetedIndex: number | undefined,
): void {
  row.period = null;
  const months: Record<string, MonthAmount> = {};
  for (const column of monthColumns) {
    months[column.period] = {
      amount: parseAmount(row.cells[column.index]),
      kind: column.kind,
    };
  }
  row.months = months;
  if (totalForecastIndex != null) {
    row.total_forecast = parseAmount(row.cells[totalForecastIndex]);
  }
  if (totalBudgetedIndex != null) {
    row.total_budgeted = parseAmount(row.cells[totalBudgetedIndex]);
  }
}

function detectForecastColumns(
  headerRows: TableRow[],
  year: number,
  preamble: string,
): {
  monthColumns: { index: number; period: string; kind: "actual" | "budget" }[];
  totalForecastIndex?: number;
  totalBudgetedIndex?: number;
} {
  const range = parseActualBudgetRange(preamble);
  const y = range.year ?? year;
  const monthColumns: { index: number; period: string; kind: "actual" | "budget" }[] = [];
  let totalForecastIndex: number | undefined;
  let totalBudgetedIndex: number | undefined;

  for (const header of headerRows) {
    header.cells.forEach((cell, index) => {
      if (index === 0) {
        return;
      }
      const period = monthFromHeader(cell, y);
      if (period) {
        const kindFromCell = kindFromHeader(cell);
        const kind =
          kindFromCell ??
          (range.actualThrough && period <= range.actualThrough ? "actual" : "budget");
        monthColumns.push({ index: index - 1, period, kind });
        return;
      }
      if (/forecast/i.test(cell) && !/budget/i.test(cell)) {
        totalForecastIndex = index - 1;
      } else if (/budgeted|annual/i.test(cell) && !monthFromHeader(cell, y)) {
        totalBudgetedIndex = index - 1;
      }
    });
    if (monthColumns.length >= 12) {
      break;
    }
  }

  return { monthColumns, totalForecastIndex, totalBudgetedIndex };
}

function applyGlMri(row: ParsedRow, account: { code?: string; name?: string }): void {
  const c = row.cells;
  const looksLikeAccountHeader = /^\d{3,5}-\d{4}$/.test(row.label);
  if (looksLikeAccountHeader) {
    row.account_code = row.label;
    row.account_name = c.find((cell, i) => i > 0 && /[A-Za-z]{3}/.test(cell) && !/^\d/.test(cell));
    row.description = c.find((cell) => /balance forward|account totals/i.test(cell));
    row.balance = parseAmount(c[c.length - 1]);
    return;
  }

  if (account.code) {
    row.account_code = account.code;
  }
  if (account.name) {
    row.account_name = account.name;
  }
  // MRI: Entity, Period, Entry Date, Src, Ref, Site, Job, Dept, Description, Debit, Credit, Balance
  // Essex: Entity, Period, Entry Date, Src Reference, junk, Job, Dept, Description, Debit, Credit, Balance
  row.entry_date = c[1] || undefined;
  const srcRef = c[2] ?? "";
  const srcParts = srcRef.split(/\s+/);
  row.source_code = srcParts[0] || (c[2] ? undefined : c[2]);
  row.reference = srcParts.slice(1).join(" ") || c[3] || undefined;
  row.description = c[c.length - 4] || c[7] || undefined;
  row.debit = parseAmount(c[c.length - 3]);
  row.credit = parseAmount(c[c.length - 2]);
  row.balance = parseAmount(c[c.length - 1]);
}

function applyGlAppfolio(
  row: ParsedRow,
  account: { code?: string; name?: string },
): void {
  if (account.code) {
    row.account_code = account.code;
  }
  if (account.name) {
    row.account_name = account.name;
  }
  const c = row.cells;
  // Date, Payee, Type, Reference, Debit, Credit, Balance, Description, Unit
  row.entry_date = row.label || undefined;
  row.source_code = c[1] || undefined;
  row.reference = c[2] || undefined;
  const payee = c[0];
  const desc = c[6];
  row.description = [payee, desc].filter(Boolean).join(" — ") || undefined;
  row.debit = parseAmount(c[3]);
  row.credit = parseAmount(c[4]);
  row.balance = parseAmount(c[5]);
}

function parseAppfolioAccount(text: string): { code?: string; name?: string } | undefined {
  const match = text.match(/(\d{3,5})\s*[-–]\s*(.+)/);
  if (!match) {
    return undefined;
  }
  const name = match[2].split("\n")[0].trim();
  return { code: match[1], name };
}

export function parseReport(
  markdown: string,
  identity: FileIdentity,
): ParsedDocument {
  if (identity.report === "skip") {
    throw new Error("parseReport called on a skipped report");
  }

  const { preamble, blocks } = parseBlocks(markdown);
  const basis =
    parseBasisFromText(preamble, identity.filenameBasis) ??
    identity.property.basis_by_year[String(identity.fiscalYear)] ??
    identity.filenameBasis;

  if (!basis) {
    throw new Error(
      `Could not determine accounting basis for ${identity.sourceFile}`,
    );
  }

  const flags: string[] = [];
  const rows: ParsedRow[] = [];
  const headerRows: TableRow[] = [];
  let rowIndex = 0;
  let page = 1;
  const splitCounts = emptySplitCounts();
  const account = { code: undefined as string | undefined, name: undefined as string | undefined };
  let forecastCols:
    | {
        monthColumns: { index: number; period: string; kind: "actual" | "budget" }[];
        totalForecastIndex?: number;
        totalBudgetedIndex?: number;
      }
    | undefined;

  const report = identity.report as ReportType;
  const period = report === "forecast_budget_report" ? null : identity.period;

  for (const block of blocks) {
    if (block.type === "text") {
      const parsedAccount = parseAppfolioAccount(block.text);
      if (parsedAccount) {
        account.code = parsedAccount.code;
        account.name = parsedAccount.name;
      }
      continue;
    }

    if (headerRows.length === 0) {
      for (const tableRow of block.rows.slice(0, 2)) {
        if (looksLikeHeaderRow(tableRow)) {
          headerRows.push(tableRow);
        }
      }
    }

    if (report === "forecast_budget_report" && !forecastCols) {
      forecastCols = detectForecastColumns(
        headerRows.length ? headerRows : block.rows.slice(0, 2),
        identity.fiscalYear,
        preamble,
      );
    }

    for (const tableRow of block.rows) {
      const rawLabel = tableRow.cells[0] ?? "";
      const rawCells = tableRow.cells.slice(1);
      const pieces =
        report === "income_statement"
          ? (() => {
              const split = splitIncomeStatementLabel(rawLabel, rawCells);
              addSplitCounts(splitCounts, split.counts);
              return split.pieces;
            })()
          : [{ label: rawLabel, cells: rawCells }];

      for (const piece of pieces) {
        const row = baseRow(identity, basis, piece.label, piece.cells, rowIndex, page, period);

        if (identity.layout) {
          applyIncomeMeasures(row, identity.layout);
        } else if (report === "standard_balance_sheet") {
          applyBalance(row);
        } else if (report === "forecast_budget_report") {
          applyForecast(
            row,
            forecastCols?.monthColumns ?? [],
            forecastCols?.totalForecastIndex,
            forecastCols?.totalBudgetedIndex,
          );
        } else if (report === "general_ledger") {
          if (identity.property.layouts.income_statement === "appfolio") {
            applyGlAppfolio(row, account);
          } else {
            applyGlMri(row, account);
            if (/^\d{3,5}-\d{4}$/.test(piece.label)) {
              account.code = piece.label;
              account.name = row.account_name;
            }
          }
        }

        if (row.label_has_value) {
          flags.push(`${identity.sourceFile}#${rowIndex}: ${piece.label}`);
        }

        rows.push(row);
        rowIndex += 1;
      }
    }

    page += 1;
  }

  if (report === "income_statement") {
    applyIncomeStatementMetadata(rows);
  }

  return {
    identity,
    basis,
    headerText: preamble,
    columnHeaders: headerRows.map((row) => row.cells),
    rows,
    flags,
    ...(report === "income_statement" ? { splitCounts } : {}),
  };
}

export function suspiciousLabel(label: string): boolean {
  return (
    labelHasValue(label) ||
    /imcome|\bncome\b|recoveral|operating\s*$/i.test(label) ||
    /\d\s+\d{3}\b/.test(label)
  );
}
