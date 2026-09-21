import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIncomeStatementMetadata,
  buildNameCodeIndex,
  canonicalize,
  classifyIncomeStatementRow,
  looksFused,
  splitIncomeStatementLabel,
  uniqueCodesOnly,
  type RepairableRow,
} from "./repair.ts";

function labels(label: string): string[] {
  return splitIncomeStatementLabel(label, ["1,234.00"]).pieces.map((piece) => piece.label);
}

function amountOwner(label: string): string[] {
  return splitIncomeStatementLabel(label, ["1,234.00"]).pieces
    .filter((piece) => piece.cells.length > 0)
    .map((piece) => piece.label);
}

describe("canonicalize", () => {
  it("renames OCR garbles and strips decoration", () => {
    assert.equal(
      canonicalize("TOTAL RECOVERAL OPERATING EXPENSES"),
      "TOTAL RECOVERABLE OPERATING EXPENSES",
    );
    assert.equal(canonicalize("TOTAL PROPERTY MANGEMENT INCOME"), "TOTAL PROPERTY MANAGEMENT INCOME");
    assert.equal(canonicalize("TOTAL OTHER SOURCES AND USE OF CASF"), "TOTAL OTHER SOURCES AND USE OF CASH");
    assert.equal(canonicalize("Prior Year Reconcilation Income"), "Prior Year Reconciliation Income");
    assert.equal(canonicalize("Gen Off - Lega Fees"), "Gen Off - Legal Fees");
    assert.equal(canonicalize("Add'I Cleaning-DayPorter"), "Add'l Cleaning-DayPorter");
    assert.equal(canonicalize("___ ___ ___ TENANT IMPROVEMENT TOTAL"), "TENANT IMPROVEMENT TOTAL");
    assert.equal(canonicalize("LEASE COMMISSION TOTAL... ... ..."), "LEASE COMMISSION TOTAL");
    assert.equal(canonicalize("Imcome"), "Income");
    assert.equal(
      canonicalize("5150-0000 - HVAC - Service Contract 0.00"),
      "5150-0000 - HVAC - Service Contract",
    );
    assert.equal(canonicalize("GENERAL MAINT/ REPAIR"), "GENERAL MAINT/REPAIR");
    assert.equal(canonicalize("Total GENERAL MAINT/REPAIR"), "Total GENERAL MAINT/REPAIR");
    assert.equal(canonicalize("Total RECREATION/ POOL EXPENSES"), "Total RECREATION/POOL EXPENSES");
  });
});

describe("splitIncomeStatementLabel", () => {
  it("splits a heading fused with an account code", () => {
    assert.deepEqual(labels("TAXES AND INSURANCE 5620-0000 - Other Taxes"), [
      "TAXES AND INSURANCE",
      "5620-0000 - Other Taxes",
    ]);
    assert.deepEqual(amountOwner("TAXES AND INSURANCE 5620-0000 - Other Taxes"), [
      "5620-0000 - Other Taxes",
    ]);
  });

  it("splits a second account code on the same line", () => {
    const pieces = labels("TAXES AND INSURANCE 5620-0000 - Other Taxes 5755-0000 - Management Fee");
    assert.deepEqual(pieces, [
      "TAXES AND INSURANCE",
      "5620-0000 - Other Taxes",
      "5755-0000 - Management Fee",
    ]);
  });

  it("splits fused totals from the next heading", () => {
    assert.deepEqual(labels("TOTAL MANAGEMENT FEES PAYROLL"), [
      "TOTAL MANAGEMENT FEES",
      "PAYROLL",
    ]);
    assert.deepEqual(labels("TOTAL DEPRECIATION AND AMORTIZATION OTHER EXPENSE"), [
      "TOTAL DEPRECIATION AND AMORTIZATION",
      "OTHER EXPENSE",
    ]);
    assert.deepEqual(
      labels("TOTAL RECOVERAL OPERATING EXPENSES NON RECOVERABLE OPERATING EXPENSES"),
      ["TOTAL RECOVERAL OPERATING EXPENSES", "NON RECOVERABLE OPERATING EXPENSES"],
    );
    assert.deepEqual(labels("TOTAL PAYROLL GENERAL OFFICE EXPENSE"), [
      "TOTAL PAYROLL",
      "GENERAL OFFICE EXPENSE",
    ]);
    assert.deepEqual(labels("TOTAL LEASING AND TENANT IMPROVEMENTS INTEREST AND FINANCING"), [
      "TOTAL LEASING AND TENANT IMPROVEMENTS",
      "INTEREST AND FINANCING",
    ]);
    assert.deepEqual(labels("TOTAL NON RECOVERABLE OP EXPENSE PARTNERSHIP EXPENSES"), [
      "TOTAL NON RECOVERABLE OP EXPENSE",
      "PARTNERSHIP EXPENSES",
    ]);
    assert.deepEqual(labels("TOTAL INTEREST AND FINANCING EXPENSE DEPRECIATION AND AMORTIZATION"), [
      "TOTAL INTEREST AND FINANCING EXPENSE",
      "DEPRECIATION AND AMORTIZATION",
    ]);
    assert.deepEqual(labels("TOTAL REVENUE OPERATING EXPENSES REPAIRS AND MAINTENANCE"), [
      "TOTAL REVENUE",
      "OPERATING EXPENSES",
      "REPAIRS AND MAINTENANCE",
    ]);
    assert.deepEqual(amountOwner("TOTAL MANAGEMENT FEES PAYROLL"), ["TOTAL MANAGEMENT FEES"]);
    assert.deepEqual(
      labels(
        "TOTAL LEASING AND TENANT IMPROVEMENTS INTEREST AND FINANCING TOTAL INTEREST AND FINANCING EXPENSE",
      ),
      [
        "TOTAL LEASING AND TENANT IMPROVEMENTS",
        "INTEREST AND FINANCING",
        "TOTAL INTEREST AND FINANCING EXPENSE",
      ],
    );
  });

  it("does not split a complete total that ends with its own heading", () => {
    assert.deepEqual(labels("TOTAL NON RECOVERABLE OPERATING EXPENSES"), [
      "TOTAL NON RECOVERABLE OPERATING EXPENSES",
    ]);
    assert.deepEqual(labels("TOTAL MANAGEMENT FEES"), ["TOTAL MANAGEMENT FEES"]);
  });

  it("splits a computed line fused with the next heading", () => {
    assert.deepEqual(labels("NET OPERATING INCOME LEASING AND TENANT IMPROVEMENTS"), [
      "NET OPERATING INCOME",
      "LEASING AND TENANT IMPROVEMENTS",
    ]);
    assert.deepEqual(amountOwner("NET OPERATING INCOME LEASING AND TENANT IMPROVEMENTS"), [
      "NET OPERATING INCOME",
    ]);
  });

  it("splits fused headings", () => {
    assert.deepEqual(labels("OPERATING INCOME RENT INCOME"), [
      "OPERATING INCOME",
      "RENT INCOME",
    ]);
    assert.deepEqual(labels("GENERAL OFFICE AND ADMINISTRATIVE MANAGEMENT FEES"), [
      "GENERAL OFFICE AND ADMINISTRATIVE",
      "MANAGEMENT FEES",
    ]);
    assert.deepEqual(labels("OPERATING EXPENSES REPAIRS AND MAINTENANCE"), [
      "OPERATING EXPENSES",
      "REPAIRS AND MAINTENANCE",
    ]);
    assert.deepEqual(labels("DIRECT EXPENSES BLDG OPERATING EXPENSE"), [
      "DIRECT EXPENSES",
      "BLDG OPERATING EXPENSE",
    ]);
  });

  it("splits a heading fused with an account name", () => {
    assert.deepEqual(labels("INTEREST AND FINANCING Mortgage Interest"), [
      "INTEREST AND FINANCING",
      "Mortgage Interest",
    ]);
    assert.deepEqual(labels("PARTNERSHIP EXPENSES Other Taxes"), [
      "PARTNERSHIP EXPENSES",
      "Other Taxes",
    ]);
    assert.deepEqual(labels("TAXES AND INSURANCE Insurance - Property"), [
      "TAXES AND INSURANCE",
      "Insurance - Property",
    ]);
    assert.deepEqual(labels("GENERAL OFFICE EXPENSE Gen Off - Postage"), [
      "GENERAL OFFICE EXPENSE",
      "Gen Off - Postage",
    ]);
    assert.deepEqual(labels("GENERAL OFFICE AND ADMINISTRATIVE MANAGEMENT FEES Management Fee"), [
      "GENERAL OFFICE AND ADMINISTRATIVE",
      "MANAGEMENT FEES",
      "Management Fee",
    ]);
    assert.deepEqual(amountOwner("INTEREST AND FINANCING Mortgage Interest"), ["Mortgage Interest"]);
  });

  it("does not split AppFolio HVAC account names on the Bell Ranch HVAC heading", () => {
    assert.deepEqual(labels("HVAC Major Rep/ Replacement"), ["HVAC Major Rep/ Replacement"]);
    assert.deepEqual(labels("HVAC Maint./Repair"), ["HVAC Maint./Repair"]);
    assert.equal(looksFused("HVAC Major Rep/ Replacement"), null);
    assert.equal(looksFused("HVAC Maint./Repair"), null);
  });

  it("leaves a clean label untouched", () => {
    assert.deepEqual(labels("4100-0000 - Commercial Rent"), ["4100-0000 - Commercial Rent"]);
    assert.equal(looksFused("4100-0000 - Commercial Rent"), null);
    assert.equal(looksFused("TAXES AND INSURANCE 5620-0000 - Other Taxes"), "mid_account_code");
  });
});

describe("applyIncomeStatementMetadata", () => {
  it("backfills a unique name-only account code and classifies rows", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "1050",
        period: "2026-04",
        label: "TAXES AND INSURANCE",
        cells: [],
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "5620-0000 - Other Taxes",
        cells: ["10.00"],
        month: 10,
        account_code: "5620-0000",
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "Commercial Rent",
        cells: ["100.00"],
        month: 100,
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "4100-0000 - Commercial Rent",
        cells: ["90.00"],
        month: 90,
        account_code: "4100-0000",
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "NET OPERATING INCOME",
        cells: ["50.00"],
        month: 50,
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "TOTAL RENT INCOME",
        cells: ["200.00"],
        month: 200,
      },
    ];

    const result = applyIncomeStatementMetadata(rows);
    assert.equal(rows[2]?.account_code, "4100-0000");
    assert.equal(result.assigned, 1);
    assert.equal(rows[0]?.row_kind, "heading");
    assert.equal(rows[1]?.row_kind, "account");
    assert.equal(rows[2]?.row_kind, "account");
    assert.equal(rows[4]?.row_kind, "computed");
    assert.equal(rows[5]?.row_kind, "total");
    assert.equal(classifyIncomeStatementRow({
      property_id: "Timbers",
      period: "2026-04",
      label: "NOI - Net Operating Income",
      cells: ["1.00"],
      month: 1,
      layout: "appfolio",
    }), "computed");
  });

  it("uses section context to disambiguate Other Taxes", () => {
    const dictionaryRows: RepairableRow[] = [
      {
        property_id: "1050",
        period: "2026-01",
        label: "TAXES AND INSURANCE",
        cells: [],
      },
      {
        property_id: "1050",
        period: "2026-01",
        label: "5620-0000 - Other Taxes",
        cells: ["1"],
        account_code: "5620-0000",
      },
      {
        property_id: "1050",
        period: "2026-01",
        label: "PARTNERSHIP EXPENSES",
        cells: [],
      },
      {
        property_id: "1050",
        period: "2026-01",
        label: "7056-0000 - Other Taxes",
        cells: ["1"],
        account_code: "7056-0000",
      },
    ];
    applyIncomeStatementMetadata(dictionaryRows);

    const targets: RepairableRow[] = [
      {
        property_id: "1050",
        period: "2026-04",
        label: "TAXES AND INSURANCE",
        cells: [],
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "Other Taxes",
        cells: ["8.00"],
        month: 8,
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "PARTNERSHIP EXPENSES",
        cells: [],
      },
      {
        property_id: "1050",
        period: "2026-04",
        label: "Other Taxes",
        cells: ["3.00"],
        month: 3,
      },
    ];
    applyIncomeStatementMetadata(targets, buildNameCodeIndex(dictionaryRows));
    assert.equal(targets[1]?.account_code, "5620-0000");
    assert.equal(targets[3]?.account_code, "7056-0000");
  });

  it("backfills Cam Revenue even when the name matches a section heading", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "1850",
        period: "2023-01",
        label: "CAM REVENUE",
        cells: [],
      },
      {
        property_id: "1850",
        period: "2023-01",
        label: "4210-0000 - Cam Revenue",
        cells: ["1"],
        month: 1,
        account_code: "4210-0000",
      },
      {
        property_id: "1850",
        period: "2023-08",
        label: "Cam Revenue",
        cells: ["3390.29"],
        month: 3390.29,
      },
    ];
    applyIncomeStatementMetadata(rows);
    assert.equal(rows[2]?.account_code, "4210-0000");
    assert.equal(rows[2]?.row_kind, "account");
    assert.equal(rows[0]?.row_kind, "heading");
  });

  it("backfills a unique code from another property when this property never printed it", () => {
    const dictionary: RepairableRow[] = [
      {
        property_id: "4633",
        period: "2026-01",
        label: "4320-0000 - Misc Other Income",
        cells: ["1"],
        account_code: "4320-0000",
      },
      {
        property_id: "1050",
        period: "2026-01",
        label: "7070-0000 - Gen Off - Bank Charge",
        cells: ["1"],
        account_code: "7070-0000",
      },
      {
        property_id: "1050",
        period: "2026-01",
        label: "5895-0000 - Gen Off - Bank Charges",
        cells: ["1"],
        account_code: "5895-0000",
      },
    ];
    const unique = uniqueCodesOnly(buildNameCodeIndex(dictionary));
    const targets: RepairableRow[] = [
      {
        property_id: "1850",
        period: "2023-08",
        label: "Misc Other Income",
        cells: ["0.87"],
        month: 0.87,
      },
      {
        property_id: "1850",
        period: "2023-08",
        label: "Gen Off - Bank Charge",
        cells: ["12.00"],
        month: 12,
      },
    ];
    applyIncomeStatementMetadata(targets, unique);
    assert.equal(targets[0]?.account_code, "4320-0000");
    assert.equal(targets[1]?.account_code, "7070-0000");
  });

  it("classifies a money-only leftover label as blank", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "530",
        period: "2024-07",
        label: "0.00",
        cells: ["0.00", "", "0.00"],
        month: 0,
      },
    ];
    applyIncomeStatementMetadata(rows);
    assert.equal(rows[0]?.row_kind, "blank");
    assert.equal(rows[0]?.account_code, undefined);
  });

  it("rejoins a page-wrapped total onto the heading already on the statement", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "Timbers",
        period: "2026-05",
        label: "REPLACEMENT ITEMS",
        cells: ["", "", "", ""],
      },
      {
        property_id: "Timbers",
        period: "2026-05",
        label: "Total REPLACEMENT",
        cells: ["3,804.50", "4.41", "6,307.24", "1.51"],
        month: 3804.5,
      },
      {
        property_id: "Timbers",
        period: "2026-05",
        label: "Account Name",
        cells: ["Selected Month", "% of Selected Month", "Year to Month End", "% of Year to Month End"],
      },
      {
        property_id: "Timbers",
        period: "2026-05",
        label: "ITEMS",
        cells: [],
      },
      {
        property_id: "Timbers",
        period: "2026-05",
        label: "GENERAL MAINT/ REPAIR",
        cells: ["", "", "", ""],
      },
    ];
    applyIncomeStatementMetadata(rows);
    assert.deepEqual(
      rows.map((row) => row.label),
      ["REPLACEMENT ITEMS", "Total REPLACEMENT ITEMS", "Account Name", "GENERAL MAINT/ REPAIR"],
    );
    assert.equal(rows[1]?.row_kind, "total");
    assert.equal(rows[1]?.canonical_label, "Total REPLACEMENT ITEMS");
    assert.equal(rows[1]?.month, 3804.5);
    assert.equal(rows[2]?.row_kind, "page_header");
  });

  it("rejoins a page-wrapped account that ends on a dangling word", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Locks- Repair or",
        cells: ["0.00", "0.00", "131.45", "0.03"],
        month: 0,
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Account Name",
        cells: ["Selected Month", "% of Selected Month", "Year to Month End", "% of Year to Month End"],
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Replace",
        cells: [],
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Door Hardware & Repairs",
        cells: ["0.00", "0.00", "0.00", "0.00"],
        month: 0,
      },
    ];
    applyIncomeStatementMetadata(rows);
    assert.deepEqual(
      rows.map((row) => row.label),
      ["Locks- Repair or Replace", "Account Name", "Door Hardware & Repairs"],
    );
    assert.equal(rows[0]?.row_kind, "account");
    assert.equal(rows[0]?.canonical_label, "Locks- Repair or Replace");
  });

  it("rejoins a page-wrapped account leftover that is not a section heading", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "Muse",
        period: "2026-07",
        label: "T/O - LVP/LVT",
        cells: ["0.00", "0.00", "5,673.75", "1.36"],
        month: 0,
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Account Name",
        cells: ["Selected Month", "% of Selected Month", "Year to Month End", "% of Year to Month End"],
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "Conversion",
        cells: [],
      },
      {
        property_id: "Muse",
        period: "2026-07",
        label: "T/O Countertop/tub/ sink/fireplace - resurfacing",
        cells: ["200.00", "0.24", "200.00", "0.05"],
        month: 200,
      },
    ];
    applyIncomeStatementMetadata(rows);
    assert.deepEqual(
      rows.map((row) => row.label),
      [
        "T/O - LVP/LVT Conversion",
        "Account Name",
        "T/O Countertop/tub/ sink/fireplace - resurfacing",
      ],
    );
    assert.equal(rows[0]?.row_kind, "account");
    assert.equal(rows[0]?.canonical_label, "T/O - LVP/LVT Conversion");
  });

  it("rejoins a page-wrapped Depreciation Expense without eating the Expense heading", () => {
    const rows: RepairableRow[] = [
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Total Operating Income",
        cells: ["93,265.07", "100.00", "466,689.64", "100.00"],
        month: 93265.07,
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Account Name",
        cells: ["Selected Month", "% of Selected Month", "Year to Month End", "% of Year to Month End"],
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Expense",
        cells: [],
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Depreciation",
        cells: ["4,812.00", "5.16", "24,060.00", "5.16"],
        month: 4812,
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Account Name",
        cells: ["Selected Month", "% of Selected Month", "Year to Month End", "% of Year to Month End"],
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Expense",
        cells: [],
      },
      {
        property_id: "Muse",
        period: "2026-05",
        label: "Total ADJUSTING ENTRIES",
        cells: ["4,812.00", "5.16", "24,060.00", "5.16"],
        month: 4812,
      },
    ];
    for (const row of rows) {
      row.layout = "appfolio";
    }
    applyIncomeStatementMetadata(rows);
    assert.deepEqual(
      rows.map((row) => row.label),
      [
        "Total Operating Income",
        "Account Name",
        "Expense",
        "Depreciation Expense",
        "Account Name",
        "Total ADJUSTING ENTRIES",
      ],
    );
    assert.equal(rows[2]?.row_kind, "heading");
    assert.equal(rows[3]?.row_kind, "account");
    assert.equal(rows[3]?.canonical_label, "Depreciation Expense");
  });
});
