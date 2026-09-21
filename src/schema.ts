import type { Db, Document } from "mongodb";

import { PROPERTIES, REPORT_TYPES, type ReportType } from "./catalog.js";
import { connectDb, closeDb } from "./db.js";
import { loadConfig } from "./config.js";

const sharedRowRequired = [
  "property_id",
  "manager",
  "basis",
  "fiscal_year",
  "as_of",
  "label",
  "cells",
  "row_index",
  "document_id",
  "page",
  "label_has_value",
];

const sharedRowProperties = {
  property_id: { bsonType: "string" },
  manager: { bsonType: "string" },
  basis: { enum: ["accrual", "cash"] },
  fiscal_year: { bsonType: ["int", "double"] },
  period: { bsonType: ["string", "null"] },
  as_of: { bsonType: "string" },
  label: { bsonType: "string" },
  cells: { bsonType: "array", items: { bsonType: "string" } },
  account_code: { bsonType: "string" },
  row_index: { bsonType: ["int", "double"] },
  document_id: { bsonType: "objectId" },
  page: { bsonType: ["int", "double"] },
  label_has_value: { bsonType: "bool" },
};

function rowValidator(extra: Record<string, unknown> = {}) {
  return {
    $jsonSchema: {
      bsonType: "object",
      required: sharedRowRequired,
      additionalProperties: true,
      properties: { ...sharedRowProperties, ...extra },
    },
  };
}

const collectionValidators: Record<ReportType, object> = {
  income_statement: rowValidator({
    layout: { enum: ["mri", "appfolio", "essex"] },
    month: { bsonType: ["double", "int", "null"] },
    ytd: { bsonType: ["double", "int", "null"] },
    canonical_label: { bsonType: "string" },
    row_kind: {
      enum: [
        "account",
        "total",
        "computed",
        "heading",
        "blank",
        "page_header",
        "meta",
        "suspect",
      ],
    },
  }),
  standard_balance_sheet: rowValidator({
    balance: { bsonType: ["double", "int", "null"] },
  }),
  forecast_budget_report: rowValidator({
    months: { bsonType: "object" },
    total_forecast: { bsonType: ["double", "int", "null"] },
    total_budgeted: { bsonType: ["double", "int", "null"] },
  }),
  general_ledger: rowValidator({
    debit: { bsonType: ["double", "int", "null"] },
    credit: { bsonType: ["double", "int", "null"] },
    balance: { bsonType: ["double", "int", "null"] },
  }),
};

async function applyValidator(db: Db, name: string, validator: object) {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name, { validator, validationLevel: "moderate" });
    return;
  }
  await db.command({
    collMod: name,
    validator,
    validationLevel: "moderate",
  });
}

export async function ensureSchema(db: Db): Promise<void> {
  await applyValidator(db, "income_statement", collectionValidators.income_statement);
  await db.collection("income_statement").createIndexes([
    { key: { property_id: 1, period: 1, basis: 1, layout: 1 }, name: "fetch" },
    { key: { document_id: 1, row_index: 1 }, name: "printed_order" },
    { key: { period: 1, basis: 1, property_id: 1 }, name: "search_period" },
  ]);

  await applyValidator(
    db,
    "standard_balance_sheet",
    collectionValidators.standard_balance_sheet,
  );
  await db.collection("standard_balance_sheet").createIndexes([
    { key: { property_id: 1, period: 1, basis: 1 }, name: "fetch" },
    { key: { document_id: 1, row_index: 1 }, name: "printed_order" },
    { key: { period: 1, basis: 1, property_id: 1 }, name: "search_period" },
  ]);

  await applyValidator(
    db,
    "forecast_budget_report",
    collectionValidators.forecast_budget_report,
  );
  await db.collection("forecast_budget_report").createIndexes([
    { key: { property_id: 1, as_of: 1, basis: 1 }, name: "fetch" },
    { key: { document_id: 1, row_index: 1 }, name: "printed_order" },
    { key: { as_of: 1, basis: 1, property_id: 1 }, name: "search_as_of" },
  ]);

  await applyValidator(db, "general_ledger", collectionValidators.general_ledger);
  await db.collection("general_ledger").createIndexes([
    { key: { property_id: 1, period: 1 }, name: "fetch" },
    { key: { document_id: 1, row_index: 1 }, name: "printed_order" },
    { key: { period: 1, property_id: 1 }, name: "search_period" },
  ]);

  await applyValidator(db, "documents", {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "property_id",
        "report",
        "basis",
        "source_file",
        "content_hash",
        "markdown",
      ],
      additionalProperties: true,
      properties: {
        property_id: { bsonType: "string" },
        report: { enum: REPORT_TYPES },
        basis: { enum: ["accrual", "cash"] },
        source_file: { bsonType: "string" },
        content_hash: { bsonType: "string" },
        markdown: { bsonType: "string" },
      },
    },
  });
  await db.collection("documents").createIndexes([
    {
      key: {
        property_id: 1,
        report: 1,
        basis: 1,
        period: 1,
        source_file: 1,
      },
      name: "identity",
      unique: true,
    },
    { key: { content_hash: 1 }, name: "content_hash" },
    { key: { source_file: 1 }, name: "source_file", unique: true },
  ]);

  await applyValidator(db, "properties", {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "name", "manager"],
      additionalProperties: true,
      properties: {
        _id: { bsonType: "string" },
        name: { bsonType: "string" },
        manager: { bsonType: "string" },
      },
    },
  });

  for (const property of PROPERTIES) {
    await db.collection("properties").replaceOne(
      { _id: property._id } as Document,
      property,
      { upsert: true },
    );
  }
}

async function main() {
  const config = loadConfig();
  const db = await connectDb(config);
  await ensureSchema(db);
  console.log(`[pearlmanai-reports-mcp] schema ready on ${config.mongoDb}`);
  await closeDb();
}

const isDirect = process.argv[1]?.includes("schema");
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
