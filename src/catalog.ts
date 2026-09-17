export type IncomeLayout = "mri" | "appfolio" | "essex";
export type AccountingBasis = "accrual" | "cash";
export type ReportType =
  | "income_statement"
  | "standard_balance_sheet"
  | "forecast_budget_report"
  | "general_ledger";

export interface PropertyRecord {
  _id: string;
  name: string;
  legal_name: string;
  manager: string;
  aliases: string[];
  mongo_db: string;
  layouts: { income_statement: IncomeLayout };
  basis_by_year: Record<string, AccountingBasis>;
}

export const PROPERTIES: PropertyRecord[] = [
  {
    _id: "1050",
    name: "1050 Broadway",
    legal_name: "La Salle LP and The AAP Trust",
    manager: "Orchard",
    aliases: ["1050"],
    mongo_db: "1050",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "1705",
    name: "1705 Rogers Avenue",
    legal_name: "1705 Rogers Avenue",
    manager: "Orchard",
    aliases: ["1705"],
    mongo_db: "1705",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "1850",
    name: "1850 Russell Avenue",
    legal_name: "1850 Russell Avenue",
    manager: "Orchard",
    aliases: ["1850"],
    mongo_db: "1850",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "2606",
    name: "2606 Bayshore Parkway",
    legal_name: "2606 Bayshore Parkway",
    manager: "Orchard",
    aliases: ["2606"],
    mongo_db: "2606",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "455",
    name: "455 De Guigne Drive",
    legal_name: "DADO LP",
    manager: "Orchard",
    aliases: ["455"],
    mongo_db: "455",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "4633",
    name: "Parkway",
    legal_name: "4633–4699 Old Ironsides Drive",
    manager: "Orchard",
    aliases: ["4633", "4655", "4677", "4699", "Parkway"],
    mongo_db: "4633",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "530",
    name: "530 Aldo Avenue",
    legal_name: "ALDO PARTNERS LLC",
    manager: "Orchard",
    aliases: ["530", "548"],
    mongo_db: "530",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "9810",
    name: "Bell Ranch",
    legal_name: "PEARLMAN PROPERTY MGMT-BELL",
    manager: "Essex",
    aliases: ["9810", "460", "Bell Ranch"],
    mongo_db: "9810",
    layouts: { income_statement: "mri" },
    basis_by_year: { "2025": "cash", "2026": "accrual" },
  },
  {
    _id: "Corbett",
    name: "Corbett Heights",
    legal_name: "Corbett Heights",
    manager: "TMG",
    aliases: ["Corbett"],
    mongo_db: "Corbett",
    layouts: { income_statement: "appfolio" },
    basis_by_year: { "2026": "cash" },
  },
  {
    _id: "Muse",
    name: "The Muse",
    legal_name: "1315 Muse LLC",
    manager: "TMG",
    aliases: ["Muse", "The Muse"],
    mongo_db: "Muse",
    layouts: { income_statement: "appfolio" },
    basis_by_year: { "2026": "cash" },
  },
  {
    _id: "Timbers",
    name: "The Timbers at Towne Center",
    legal_name: "Timbers Apartments Vancouver LP",
    manager: "TMG",
    aliases: ["Timbers", "The Timbers"],
    mongo_db: "Timbers",
    layouts: { income_statement: "appfolio" },
    basis_by_year: { "2026": "cash" },
  },
];

const byKey = new Map<string, PropertyRecord>();
for (const property of PROPERTIES) {
  byKey.set(normalizeKey(property._id), property);
  byKey.set(normalizeKey(property.name), property);
  for (const alias of property.aliases) {
    byKey.set(normalizeKey(alias), property);
  }
}

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/^the\s+/, "");
}

export function resolveProperty(input: string): PropertyRecord | undefined {
  return byKey.get(normalizeKey(input));
}

export function requireProperty(input: string): PropertyRecord {
  const property = resolveProperty(input);
  if (!property) {
    throw new Error(
      `Unknown property "${input}". Known ids: ${PROPERTIES.map((p) => p._id).join(", ")}. Aliases include 548→530, 460→9810, The Muse→Muse.`,
    );
  }
  return property;
}

export const REPORT_TYPES: ReportType[] = [
  "income_statement",
  "standard_balance_sheet",
  "forecast_budget_report",
  "general_ledger",
];

export const SKIPPED_REPORT_NAMES = ["Cash Flow"] as const;

export const REPORT_COLLECTIONS: Record<ReportType, string> = {
  income_statement: "comparative_income_statement",
  standard_balance_sheet: "balance_sheet",
  forecast_budget_report: "forecast_budget_report",
  general_ledger: "general_ledger_report",
};

export const FILENAME_REPORTS: { prefix: string; report: ReportType | "skip" }[] =
  [
    { prefix: "Comparative Income Statement", report: "income_statement" },
    { prefix: "Income Statement", report: "income_statement" },
    { prefix: "Standard Balance Sheet", report: "standard_balance_sheet" },
    { prefix: "Forecast - Budget Report", report: "forecast_budget_report" },
    { prefix: "General Ledger", report: "general_ledger" },
    { prefix: "Cash Flow", report: "skip" },
  ];
