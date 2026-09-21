import "dotenv/config";

import { closeDb, connectDb } from "../db.js";
import { loadConfig } from "../config.js";
import { ensureSchema } from "../schema.js";
import { ingest, printSummary } from "./load.js";

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

async function main() {
  const src = arg("src");
  if (!src) {
    console.error(
      "Usage: npm run ingest -- --src <dir> [--property X] [--report Y] [--dry-run]",
    );
    process.exit(1);
  }

  const dryRun = flag("dry-run");
  const config = loadConfig();

  if (dryRun) {
    const summary = await ingest(null, {
      src,
      property: arg("property"),
      report: arg("report"),
      dryRun: true,
    });
    printSummary(summary);
    return;
  }

  const db = await connectDb(config);
  await ensureSchema(db);
  const summary = await ingest(db, {
    src,
    property: arg("property"),
    report: arg("report"),
    dryRun: false,
  });
  printSummary(summary);
  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
