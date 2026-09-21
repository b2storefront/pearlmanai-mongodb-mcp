import { extractAccountCode, parseAmount } from "./amounts.js";

export type RowKind =
  | "account"
  | "total"
  | "computed"
  | "heading"
  | "blank"
  | "page_header"
  | "meta"
  | "suspect";

export interface SplitPiece {
  label: string;
  cells: string[];
}

export interface SplitCounts {
  account_code: number;
  total_heading: number;
  computed_heading: number;
  heading_heading: number;
  heading_account: number;
}

export interface NameCodeHit {
  code: string;
  heading: string | null;
}

export type NameCodeIndex = Map<string, NameCodeHit[]>;

export interface RepairableRow {
  property_id: string;
  period: string | null;
  label: string;
  cells: string[];
  account_code?: string;
  canonical_label?: string;
  row_kind?: RowKind;
  month?: number | null;
  ytd?: number | null;
  budget?: number | null;
  balance?: number | null;
  layout?: string | null;
}

const MRI_HEADINGS = [
  "OPERATING INCOME",
  "RENT INCOME",
  "CAM REVENUE",
  "OTHER INCOME",
  "PROPERTY MANAGEMENT INCOME",
  "OPERATING EXPENSES",
  "REPAIRS AND MAINTENANCE",
  "GROUND LEASE",
  "UTILITIES",
  "TAXES AND INSURANCE",
  "GENERAL OFFICE AND ADMINISTRATIVE",
  "MANAGEMENT FEES",
  "PAYROLL",
  "GENERAL OFFICE EXPENSE",
  "NON RECOVERABLE OPERATING EXPENSES",
  "PARTNERSHIP EXPENSES",
  "LEASING AND TENANT IMPROVEMENTS",
  "INTEREST AND FINANCING",
  "DEPRECIATION AND AMORTIZATION",
  "OTHER EXPENSE",
  "CAPITAL ACTIVITY",
  "TENANT IMPROVEMENT TOTAL",
  "LEASE COMMISSION TOTAL",
  "OTHER SOURCES AND USE OF CASH",
];

const BELL_RANCH_HEADINGS = [
  "INCOME",
  "DIRECT EXPENSES",
  "BLDG OPERATING EXPENSE",
  "CLEANING",
  "SECURITY",
  "LANDSCAPING",
  "PARKING LOT",
  "HVAC",
  "INSURANCE",
  "REAL ESTATE TAXES",
  "MISCELLANEOUS",
  "INDIRECT EXPENSES / INCOME",
];

const ESSEX_HEADINGS = [
  "INCOME",
  "RENTAL INCOME",
  "RECOVERY INCOME",
  "OTHER INCOME",
  "EXPENSES",
  "DIRECT OPERATING EXPENSES",
  "OTHER INCOME & EXPENSES",
];

const COMPUTED_LINES = ["NET OPERATING INCOME", "NET INCOME", "NET CASHFLOW"];

const EXTRA_TOTALS = [
  "TOTAL REVENUE",
  "TOTAL INTEREST AND FINANCING EXPENSE",
  "TOTAL NON RECOVERABLE OP EXPENSE",
  "TOTAL INCOME",
  "TOTAL DIRECT EXPENSE",
  "TOTAL REPAIRS & MAINTENANCE",
  "TOTAL PROPERTY MANAGEMENT INCOME",
  "TOTAL RECOVERABLE OPERATING EXPENSES",
  "TOTAL NON RECOVERABLE OPERATING EXPENSES",
];

const RENAME_RULES: Array<[RegExp, string]> = [
  [/\bRECOVERAL\b/gi, "RECOVERABLE"],
  [/\bRECOVERER\b/gi, "RECOVERABLE"],
  [/\bRECOVERING\b/gi, "RECOVERABLE"],
  [/\bRECOVER\b/gi, "RECOVERABLE"],
  [/\bMANGEMENT\b/gi, "MANAGEMENT"],
  [/\bCASF\b/gi, "CASH"],
  [/\bCASI\b/gi, "CASH"],
  [/\bImcome\b/g, "Income"],
  [/\bReconcilation\b/gi, "Reconciliation"],
  [/\bLega Fees\b/gi, "Legal Fees"],
  [/Add'I/g, "Add'l"],
];

const PAGE_HEADER_RE =
  /^(account name|selected month|year to month|ytd actual|actual|budget \(std\))$/i;

export const HEADINGS_LONGEST: string[] = uniqueSorted([
  ...MRI_HEADINGS,
  ...BELL_RANCH_HEADINGS,
  ...ESSEX_HEADINGS,
]);

const HEADING_SET = new Set(HEADINGS_LONGEST);
const COMPUTED_SET = new Set(COMPUTED_LINES);
const EXTRA_TOTAL_SET = new Set(EXTRA_TOTALS);
const COMPUTED_LONGEST = [...COMPUTED_LINES].sort((a, b) => b.length - a.length);
const KNOWN_TOTALS_LONGEST: string[] = uniqueSorted([
  ...EXTRA_TOTALS,
  ...HEADINGS_LONGEST.map((heading) => `TOTAL ${heading}`),
]);

export function emptySplitCounts(): SplitCounts {
  return {
    account_code: 0,
    total_heading: 0,
    computed_heading: 0,
    heading_heading: 0,
    heading_account: 0,
  };
}

export function addSplitCounts(target: SplitCounts, extra: SplitCounts): void {
  target.account_code += extra.account_code;
  target.total_heading += extra.total_heading;
  target.computed_heading += extra.computed_heading;
  target.heading_heading += extra.heading_heading;
  target.heading_account += extra.heading_account;
}

export function stripDecoration(label: string): string {
  return label
    .replace(/[_.]{2,}/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyRenameMap(label: string): string {
  let out = label;
  for (const [pattern, replacement] of RENAME_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function stripTrailingMoney(label: string): string {
  return label
    .replace(/\s+-?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?\s*$/, "")
    .replace(/\s+-?\(?\d+\.\d{2}\)?\s*$/, "")
    .trim();
}

export function canonicalize(label: string): string {
  return applyRenameMap(stripDecoration(stripTrailingMoney(label))).replace(/\s*\/\s*/g, "/");
}

export function splitIncomeStatementLabel(
  label: string,
  cells: string[],
): { pieces: SplitPiece[]; counts: SplitCounts } {
  const counts = emptySplitCounts();
  const working = stripDecoration(label);
  const source = working === "" ? label.trim() : working;
  const pieces = splitUntilStable(
    [{ label: source, cells: cells.slice(), keepAmounts: true }],
    counts,
  );
  if (pieces.length === 1) {
    return {
      pieces: [{ label: stripTrailingMoney(label), cells: cells.slice() }],
      counts,
    };
  }
  return {
    pieces: pieces.map((piece) => ({
      ...piece,
      label: stripTrailingMoney(piece.label),
    })),
    counts,
  };
}

export function looksFused(label: string): string | null {
  const stripped = stripDecoration(label);
  if (nextMidAccountCode(stripped) !== null) {
    return "mid_account_code";
  }
  const canonical = canonicalize(stripped).toUpperCase();
  if (findLeadingTotalSplit(canonical) || findTotalHeadingSplit(canonical)) {
    return "total_heading";
  }
  if (findComputedHeadingSplit(canonical)) {
    return "computed_heading";
  }
  if (findHeadingHeadingSplit(canonical)) {
    return "heading_heading";
  }
  if (findHeadingTotalSplit(canonical)) {
    return "heading_total";
  }
  if (findHeadingAccountSplit(stripped, canonical)) {
    return "heading_account";
  }
  return null;
}

export function buildNameCodeIndex(rows: RepairableRow[]): NameCodeIndex {
  const index: NameCodeIndex = new Map();
  let heading: string | null = null;
  for (const row of rows) {
    const canonical = (row.canonical_label ?? canonicalize(row.label)).toUpperCase();
    if (HEADING_SET.has(canonical)) {
      heading = canonical;
    }
    const parsed = parseCodedName(row.label, row.account_code);
    if (!parsed) {
      continue;
    }
    const key = canonicalize(parsed.name);
    const hits = index.get(key) ?? [];
    if (!hits.some((hit) => hit.code === parsed.code && hit.heading === heading)) {
      hits.push({ code: parsed.code, heading });
    }
    index.set(key, hits);
  }
  return index;
}

export function mergeNameCodeIndexes(into: NameCodeIndex, from: NameCodeIndex): NameCodeIndex {
  for (const [name, hits] of from) {
    const existing = into.get(name) ?? [];
    for (const hit of hits) {
      if (!existing.some((row) => row.code === hit.code && row.heading === hit.heading)) {
        existing.push(hit);
      }
    }
    into.set(name, existing);
  }
  return into;
}

/** Names that map to exactly one account code (safe to apply across properties). */
export function uniqueCodesOnly(index: NameCodeIndex): NameCodeIndex {
  const unique: NameCodeIndex = new Map();
  for (const [name, hits] of index) {
    const codes = [...new Set(hits.map((hit) => hit.code))];
    if (codes.length === 1 && codes[0]) {
      unique.set(name, [{ code: codes[0], heading: null }]);
    }
  }
  return unique;
}

export function applyNameCodeBackfill(
  rows: RepairableRow[],
  index: NameCodeIndex,
): { assigned: number; ambiguous: string[] } {
  let assigned = 0;
  const ambiguous: string[] = [];
  let heading: string | null = null;

  for (const row of rows) {
    const canonical = (row.canonical_label ?? canonicalize(row.label)).toUpperCase();
    if (HEADING_SET.has(canonical)) {
      heading = canonical;
    }
    if (row.account_code) {
      continue;
    }
    if (!isNameOnlyAccountCandidate(row)) {
      continue;
    }

    const key = canonicalize(row.label);
    const hits = index.get(key);
    if (!hits || hits.length === 0) {
      continue;
    }
    const uniqueCodes = [...new Set(hits.map((hit) => hit.code))];
    let code: string | undefined;
    if (uniqueCodes.length === 1) {
      code = uniqueCodes[0];
    } else if (heading) {
      const contextual = hits.find((hit) => hit.heading === heading);
      if (contextual) {
        code = contextual.code;
      }
    }
    if (code) {
      row.account_code = code;
      assigned += 1;
    } else {
      ambiguous.push(`${row.property_id} ${row.period ?? ""} ${row.label}`);
    }
  }

  return { assigned, ambiguous };
}

export function classifyIncomeStatementRow(row: RepairableRow): RowKind {
  const label = row.label.trim();
  const canonical = (row.canonical_label ?? canonicalize(label)).toUpperCase();
  const amounts = rowHasAmounts(row);

  if (PAGE_HEADER_RE.test(label) || PAGE_HEADER_RE.test(canonical)) {
    return "page_header";
  }
  if (isMetaLabel(label) || isMetaLabel(canonical)) {
    return "meta";
  }
  if (isMoneyOnlyLabel(label)) {
    return "blank";
  }
  if (label === "" && !amounts) {
    return "blank";
  }
  if (canonical.startsWith("TOTAL ")) {
    return "total";
  }
  if (isComputedCanonical(canonical)) {
    return "computed";
  }
  if (HEADING_SET.has(canonical) && !amounts) {
    return "heading";
  }
  if (row.account_code || (amounts && /[a-z]/.test(label))) {
    return "account";
  }
  if (HEADING_SET.has(canonical)) {
    return "heading";
  }
  if (!amounts && /[A-Za-z]{3}/.test(label) && (row.layout === "appfolio" || row.layout === "essex")) {
    return "heading";
  }
  if (amounts && label !== "") {
    return "account";
  }
  if (label === "") {
    return "blank";
  }
  return "suspect";
}

export function applyIncomeStatementMetadata(
  rows: RepairableRow[],
  index?: NameCodeIndex,
): { assigned: number; ambiguous: string[] } {
  stitchWrappedIncomeStatementRows(rows);
  for (const row of rows) {
    row.canonical_label = canonicalize(row.label);
    if (!row.account_code) {
      const code = extractAccountCode(row.label);
      if (code) {
        row.account_code = code;
      }
    }
  }

  const dict = index ? mergeNameCodeIndexes(buildNameCodeIndex(rows), index) : buildNameCodeIndex(rows);
  const backfill = applyNameCodeBackfill(rows, dict);
  for (const row of rows) {
    row.row_kind = classifyIncomeStatementRow(row);
  }
  return backfill;
}

function splitUntilStable(
  pending: Array<SplitPiece & { keepAmounts: boolean }>,
  counts: SplitCounts,
): SplitPiece[] {
  const out: SplitPiece[] = [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      break;
    }
    const stripped = stripDecoration(current.label);
    const canonical = canonicalize(stripped).toUpperCase();

    const r2 = nextMidAccountCode(stripped);
    if (r2) {
      const prefix = stripped.slice(0, r2.index).trim();
      const suffix = stripped.slice(r2.index).trim();
      const prefixIsAccount = /^\d{3,5}-\d{4}\b/.test(prefix);
      counts.account_code += 1;
      pending.unshift(
        piece(prefix, current.cells, prefixIsAccount ? current.keepAmounts : false),
        piece(suffix, current.cells, prefixIsAccount ? false : current.keepAmounts),
      );
      continue;
    }

    const leadingTotal = findLeadingTotalSplit(canonical);
    if (leadingTotal) {
      const parts = splitOriginalAroundSuffix(stripped, leadingTotal.rest);
      if (parts) {
        counts.total_heading += 1;
        pending.unshift(
          piece(parts.prefix, current.cells, current.keepAmounts),
          piece(parts.suffix, current.cells, false),
        );
        continue;
      }
    }

    const totalSplit = findTotalHeadingSplit(canonical);
    if (totalSplit) {
      const parts = splitOriginalAroundSuffix(stripped, totalSplit.heading);
      if (parts) {
        counts.total_heading += 1;
        pending.unshift(
          piece(parts.prefix, current.cells, current.keepAmounts),
          piece(parts.suffix, current.cells, false),
        );
        continue;
      }
    }

    const computedSplit = findComputedHeadingSplit(canonical);
    if (computedSplit) {
      const parts = splitOriginalAroundSuffix(stripped, computedSplit.heading);
      if (parts) {
        counts.computed_heading += 1;
        pending.unshift(
          piece(parts.prefix, current.cells, current.keepAmounts),
          piece(parts.suffix, current.cells, false),
        );
        continue;
      }
    }

    const headingSplit = findHeadingHeadingSplit(canonical);
    if (headingSplit) {
      const parts = splitOriginalAroundSuffix(stripped, headingSplit.right);
      if (parts) {
        counts.heading_heading += 1;
        pending.unshift(
          piece(parts.prefix, current.cells, false),
          piece(parts.suffix, current.cells, false),
        );
        continue;
      }
    }

    const headingTotal = findHeadingTotalSplit(canonical);
    if (headingTotal) {
      const parts = splitOriginalAroundSuffix(stripped, headingTotal.total);
      if (parts) {
        counts.total_heading += 1;
        pending.unshift(
          piece(parts.prefix, current.cells, false),
          piece(parts.suffix, current.cells, current.keepAmounts),
        );
        continue;
      }
    }

    const accountSplit = findHeadingAccountSplit(stripped, canonical);
    if (accountSplit) {
      counts.heading_account += 1;
      pending.unshift(
        piece(accountSplit.heading, current.cells, false),
        piece(accountSplit.account, current.cells, current.keepAmounts),
      );
      continue;
    }

    out.push({
      label: stripTrailingMoney(stripped),
      cells: current.keepAmounts ? current.cells.slice() : [],
    });
  }

  return out;
}

function piece(
  label: string,
  cells: string[],
  keepAmounts: boolean,
): SplitPiece & { keepAmounts: boolean } {
  return { label, cells, keepAmounts };
}

function nextMidAccountCode(label: string): { index: number; code: string } | null {
  const re = /\b\d{3,5}-\d{4}\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(label))) {
    if (match.index > 0) {
      return { index: match.index, code: match[0] };
    }
  }
  return null;
}

function findLeadingTotalSplit(canonical: string): { prefix: string; rest: string } | null {
  for (const total of KNOWN_TOTALS_LONGEST) {
    if (canonical === total || !canonical.startsWith(`${total} `)) {
      continue;
    }
    const rest = canonical.slice(total.length + 1);
    if (restStartsWithKnownStructure(rest)) {
      return { prefix: total, rest };
    }
  }
  return null;
}

function findHeadingTotalSplit(canonical: string): { heading: string; total: string } | null {
  for (const heading of HEADINGS_LONGEST) {
    if (canonical === heading || !canonical.startsWith(`${heading} `)) {
      continue;
    }
    const rest = canonical.slice(heading.length + 1);
    if (isKnownTotal(rest)) {
      return { heading, total: rest };
    }
  }
  return null;
}

function restStartsWithKnownStructure(canonical: string): boolean {
  if (HEADING_SET.has(canonical) || isKnownTotal(canonical) || isComputedCanonical(canonical)) {
    return true;
  }
  for (const heading of HEADINGS_LONGEST) {
    if (canonical.startsWith(`${heading} `)) {
      return true;
    }
  }
  for (const total of KNOWN_TOTALS_LONGEST) {
    if (canonical.startsWith(`${total} `)) {
      return true;
    }
  }
  return COMPUTED_LONGEST.some((line) => canonical.startsWith(`${line} `));
}

function findTotalHeadingSplit(
  canonical: string,
): { prefix: string; heading: string } | null {
  if (!canonical.startsWith("TOTAL ")) {
    return null;
  }
  for (const heading of HEADINGS_LONGEST) {
    const token = ` ${heading}`;
    if (!canonical.endsWith(token)) {
      continue;
    }
    const prefix = canonical.slice(0, -token.length);
    if (prefix === "TOTAL") {
      continue;
    }
    if (isKnownTotal(prefix) || findTotalHeadingSplit(prefix) || findHeadingHeadingSplit(prefix)) {
      return { prefix, heading };
    }
  }
  return null;
}

function findComputedHeadingSplit(
  canonical: string,
): { prefix: string; heading: string } | null {
  for (const computed of COMPUTED_LONGEST) {
    if (canonical === computed || !canonical.startsWith(`${computed} `)) {
      continue;
    }
    const rest = canonical.slice(computed.length + 1);
    for (const heading of HEADINGS_LONGEST) {
      if (rest === heading) {
        return { prefix: computed, heading };
      }
    }
  }
  return null;
}

function findHeadingHeadingSplit(
  canonical: string,
): { left: string; right: string } | null {
  for (const left of HEADINGS_LONGEST) {
    if (canonical === left || !canonical.startsWith(`${left} `)) {
      continue;
    }
    const rest = canonical.slice(left.length + 1);
    if (HEADING_SET.has(rest)) {
      return { left, right: rest };
    }
  }
  return null;
}

function findHeadingAccountSplit(
  stripped: string,
  canonical: string,
): { heading: string; account: string } | null {
  for (const heading of HEADINGS_LONGEST) {
    // Single-word headings (HVAC, INSURANCE, PAYROLL) are also common
    // prefixes of real account names, especially on AppFolio prints.
    if (!heading.includes(" ")) {
      continue;
    }
    if (canonical === heading || !canonical.startsWith(`${heading} `)) {
      continue;
    }
    const prefixRe = new RegExp(`^(${escapeRegex(heading)})\\s+(.+)$`, "i");
    const match = stripped.match(prefixRe);
    if (!match) {
      continue;
    }
    const remainder = match[2] ?? "";
    if (!/^[A-Za-z]/.test(remainder) || !/[a-z]/.test(remainder)) {
      continue;
    }
    if (!isMostlyUppercase(match[1])) {
      continue;
    }
    return { heading: match[1], account: remainder };
  }
  return null;
}

function isMostlyUppercase(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, "");
  if (!letters) {
    return false;
  }
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.9;
}

function isKnownTotal(canonical: string): boolean {
  const upper = canonical.toUpperCase();
  if (EXTRA_TOTAL_SET.has(upper)) {
    return true;
  }
  if (!upper.startsWith("TOTAL ")) {
    return false;
  }
  return HEADING_SET.has(upper.slice("TOTAL ".length));
}

function splitOriginalAroundSuffix(
  original: string,
  suffix: string,
): { prefix: string; suffix: string } | null {
  const match = original.match(new RegExp(`^(.*?)\\s+(${escapeRegex(suffix)})\\s*$`, "i"));
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return { prefix: match[1].trim(), suffix: match[2].trim() };
}

function parseCodedName(
  label: string,
  accountCode: string | undefined,
): { code: string; name: string } | null {
  const match = label.match(/^(\d{3,5}-\d{4})\s*[-–]\s*(.+)$/);
  if (match) {
    return { code: match[1], name: match[2].trim() };
  }
  if (accountCode && /^\d{3,5}-\d{4}$/.test(accountCode)) {
    const name = label.replace(new RegExp(`^${escapeRegex(accountCode)}\\s*[-–]?\\s*`), "").trim();
    if (name && name !== label) {
      return { code: accountCode, name };
    }
  }
  return null;
}

function isComputedCanonical(canonical: string): boolean {
  if (COMPUTED_SET.has(canonical)) {
    return true;
  }
  if (/^NOI\b/.test(canonical) || /\bNET OPERATING INCOME\b/.test(canonical)) {
    return true;
  }
  if (/\bNET CASHFLOW\b/.test(canonical) || /\bNET INCOME\b/.test(canonical)) {
    return true;
  }
  return COMPUTED_LONGEST.some((line) => canonical.startsWith(`${line} `));
}

function isMoneyOnlyLabel(label: string): boolean {
  return /^-?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?$/.test(label.trim());
}

function isNameOnlyAccountCandidate(row: RepairableRow): boolean {
  const label = row.label.trim();
  if (label === "" || extractAccountCode(label) || isMoneyOnlyLabel(label)) {
    return false;
  }
  const canonical = (row.canonical_label ?? canonicalize(label)).toUpperCase();
  if (COMPUTED_SET.has(canonical) || canonical.startsWith("TOTAL ")) {
    return false;
  }
  if (HEADING_SET.has(canonical) && !rowHasAmounts(row)) {
    return false;
  }
  return /[a-z]/.test(label) || rowHasAmounts(row);
}

function stitchWrappedIncomeStatementRows(rows: RepairableRow[]): void {
  const headings = documentHeadings(rows);
  const out: RepairableRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    let j = i + 1;
    while (j < rows.length && isWrapNoise(rows[j])) {
      j += 1;
    }
    const next = j < rows.length ? rows[j] : undefined;
    if (row && next && canStitchWrappedLabels(row, next, headings)) {
      row.label = `${row.label.trim()} ${next.label.trim()}`;
      out.push(row);
      for (let k = i + 1; k < j; k += 1) {
        const noise = rows[k];
        if (noise) {
          out.push(noise);
        }
      }
      i = j;
      continue;
    }
    if (row) {
      out.push(row);
    }
  }

  rows.length = 0;
  rows.push(...out);
}

function documentHeadings(rows: RepairableRow[]): Set<string> {
  const headings = new Set<string>();
  for (const row of rows) {
    if (rowHasAmounts(row) || isWrapNoise(row)) {
      continue;
    }
    const canonical = canonicalize(row.label).toUpperCase();
    if (canonical.startsWith("TOTAL ") || canonical.split(/\s+/).length < 2) {
      continue;
    }
    if (/[A-Z]/.test(canonical)) {
      headings.add(canonical);
    }
  }
  return headings;
}

function canStitchWrappedLabels(
  left: RepairableRow,
  right: RepairableRow,
  headings: Set<string>,
): boolean {
  if (isWrapNoise(left) || isWrapNoise(right) || rowHasAmounts(right)) {
    return false;
  }
  const remainder = canonicalize(right.label);
  if (remainder.split(/\s+/).filter(Boolean).length > 2) {
    return false;
  }
  if (!/^[A-Za-z0-9/&.-]+(?:\s+[A-Za-z0-9/&.-]+)?$/.test(remainder)) {
    return false;
  }
  const combined = canonicalize(`${left.label} ${right.label}`).toUpperCase();
  if (headings.has(combined)) {
    return true;
  }
  if (combined.startsWith("TOTAL ") && headings.has(combined.slice("TOTAL ".length))) {
    return true;
  }
  if (looksLikeWrappedFragment(left.label)) {
    return true;
  }
  return canStitchWrappedAccountRemainder(left, right);
}

function canStitchWrappedAccountRemainder(left: RepairableRow, right: RepairableRow): boolean {
  if (!rowHasAmounts(left)) {
    return false;
  }
  const leftCanon = canonicalize(left.label).toUpperCase();
  if (leftCanon.startsWith("TOTAL ") || COMPUTED_SET.has(leftCanon)) {
    return false;
  }
  if (!/[a-z]/.test(right.label.trim())) {
    return false;
  }
  const remainder = canonicalize(right.label);
  if (remainder.split(/\s+/).filter(Boolean).length !== 1) {
    return false;
  }
  const upper = remainder.toUpperCase();
  if (leftCanon === "DEPRECIATION" && upper === "EXPENSE") {
    return true;
  }
  if (HEADING_SET.has(upper) || COMPUTED_SET.has(upper) || /^(INCOME|EXPENSE|EXPENSES)$/.test(upper)) {
    return false;
  }
  return true;
}

function looksLikeWrappedFragment(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed === "") {
    return false;
  }
  if (/[-/]$/.test(trimmed)) {
    return true;
  }
  return /\b(or|and|of|the|to|for|a|an)$/i.test(trimmed);
}

function isWrapNoise(row: RepairableRow): boolean {
  const label = row.label.trim();
  if (label === "") {
    return true;
  }
  return PAGE_HEADER_RE.test(label) || isMetaLabel(label);
}

function rowHasAmounts(row: RepairableRow): boolean {
  if (row.month != null || row.ytd != null || row.budget != null || row.balance != null) {
    return true;
  }
  return row.cells.some((cell) => parseAmount(cell) != null);
}

function isMetaLabel(label: string): boolean {
  const trimmed = label.trim();
  if (/^(thru:|database:|proj:)/i.test(trimmed)) {
    return true;
  }
  if (/\bthru:/i.test(trimmed) || /^thru$/i.test(trimmed)) {
    return true;
  }
  if (/^actual\s+thru\b/i.test(trimmed)) {
    return true;
  }
  if (/^(cash|accrual)$/i.test(trimmed)) {
    return true;
  }
  if (/^current period\b/i.test(trimmed)) {
    return true;
  }
  if (/report includes an open period/i.test(trimmed)) {
    return true;
  }
  if (/^report id\b/i.test(trimmed) || /\bdatabase\b/i.test(trimmed)) {
    return true;
  }
  if (/^1\.\s*\[/.test(trimmed) || /^(a\.\s*){5,}/i.test(trimmed)) {
    return true;
  }
  if (/^[A-Z]$/.test(trimmed)) {
    return true;
  }
  if (trimmed.length > 80 && !/\d{3,5}-\d{4}/.test(trimmed)) {
    return true;
  }
  return false;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
