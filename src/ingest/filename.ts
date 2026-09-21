import {
  FILENAME_REPORTS,
  requireProperty,
  type AccountingBasis,
  type IncomeLayout,
  type PropertyRecord,
  type ReportType,
} from "../catalog.js";

export interface FileIdentity {
  property: PropertyRecord;
  folderName: string;
  reportName: string;
  report: ReportType | "skip";
  period: string;
  fiscalYear: number;
  filenameBasis?: AccountingBasis;
  layout?: IncomeLayout;
  sourceFile: string;
  sourcePdf?: string;
}

const PERIOD_RE = /FR[ -]?(\d{4})(\d{2})/i;

export function parseFilename(
  filename: string,
  folderName: string,
): FileIdentity {
  const base = filename.replace(/\.(md|json|pdf)$/i, "");
  const reportEntry = FILENAME_REPORTS.find((entry) =>
    base.startsWith(entry.prefix),
  );
  if (!reportEntry) {
    throw new Error(
      `Unrecognised report name in "${filename}". Known prefixes: ${FILENAME_REPORTS.map((e) => e.prefix).join(", ")}.`,
    );
  }

  const property = requireProperty(folderName.replace(/-splitted$/i, ""));
  const periodMatch = base.match(PERIOD_RE);
  if (!periodMatch) {
    throw new Error(`Could not parse period from filename "${filename}"`);
  }

  const period = `${periodMatch[1]}-${periodMatch[2]}`;
  const fiscalYear = Number(periodMatch[1]);
  const filenameBasis: AccountingBasis | undefined = /\bAccrual\b/i.test(base)
    ? "accrual"
    : /\bCash\b/i.test(base)
      ? "cash"
      : undefined;

  let layout: IncomeLayout | undefined;
  if (reportEntry.report === "income_statement") {
    if (reportEntry.prefix === "Comparative Income Statement") {
      layout = "mri";
    } else if (property._id === "9810") {
      layout = "essex";
    } else {
      layout = property.layouts.income_statement;
    }
  }

  return {
    property,
    folderName,
    reportName: reportEntry.prefix,
    report: reportEntry.report,
    period,
    fiscalYear,
    filenameBasis,
    layout,
    sourceFile: filename,
  };
}

export function parseBasisFromText(
  text: string,
  fallback?: AccountingBasis,
): AccountingBasis | undefined {
  const labelled = text.match(/Accounting Basis:\s*(Cash|Accrual)/i);
  if (labelled) {
    return labelled[1].toLowerCase() as AccountingBasis;
  }
  if (/^\s*Accrual\s*$/im.test(text) || /\nAccrual\n/.test(text)) {
    return "accrual";
  }
  if (/^\s*Cash\s*$/im.test(text) || /\nCash\n/.test(text)) {
    return "cash";
  }
  return fallback;
}

export function identityFromStoredDocument(doc: {
  property_id: string;
  report: ReportType;
  basis: AccountingBasis;
  period?: string | null;
  as_of?: string | null;
  layout?: IncomeLayout | null;
  source_file: string;
}): FileIdentity {
  const period = doc.period || doc.as_of || "";
  if (!period) {
    throw new Error(`Stored document ${doc.source_file} has no period or as_of`);
  }

  try {
    const identity = parseFilename(doc.source_file, doc.property_id);
    identity.filenameBasis = doc.basis;
    if (doc.layout) {
      identity.layout = doc.layout;
    }
    return identity;
  } catch {
    const property = requireProperty(doc.property_id);
    const reportEntry = FILENAME_REPORTS.find((entry) => entry.report === doc.report);
    return {
      property,
      folderName: doc.property_id,
      reportName: reportEntry?.prefix ?? doc.report,
      report: doc.report,
      period,
      fiscalYear: Number(period.slice(0, 4)),
      filenameBasis: doc.basis,
      layout: doc.layout ?? undefined,
      sourceFile: doc.source_file,
    };
  }
}
