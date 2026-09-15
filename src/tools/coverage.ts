import { PROPERTIES, REPORT_COLLECTIONS, REPORT_TYPES, type ReportType } from "../catalog.js";
import { propertyDb } from "../db.js";

export interface CoverageCache {
  builtAt: string;
  properties: typeof PROPERTIES;
  reports: ReportType[];
  documents: number;
  byProperty: {
    property_id: string;
    name: string;
    manager: string;
    mongo_db: string;
    reports: {
      report: ReportType;
      collection: string;
      periods: string[];
      documents: number;
    }[];
  }[];
  byReport: {
    report: ReportType;
    documents: number;
    properties: string[];
    periods: string[];
  }[];
}

const TTL_MS = 5 * 60 * 1000;
let cache: { value: CoverageCache; expires: number } | undefined;

export function invalidateCoverage(): void {
  cache = undefined;
}

export async function getCoverage(): Promise<CoverageCache> {
  if (cache && cache.expires > Date.now()) {
    return cache.value;
  }

  const byReportMap = new Map<
    ReportType,
    { documents: number; properties: Set<string>; periods: Set<string> }
  >();
  for (const report of REPORT_TYPES) {
    byReportMap.set(report, { documents: 0, properties: new Set(), periods: new Set() });
  }

  const byProperty: CoverageCache["byProperty"] = [];
  let documents = 0;

  for (const property of PROPERTIES) {
    const db = propertyDb(property.mongo_db);
    const reports: CoverageCache["byProperty"][number]["reports"] = [];

    for (const report of REPORT_TYPES) {
      const collectionName = REPORT_COLLECTIONS[report];
      const col = db.collection(collectionName);
      const months = (await col.distinct("reportMonth"))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .sort();
      if (months.length === 0) {
        continue;
      }
      const count = await col.countDocuments();
      documents += count;
      reports.push({
        report,
        collection: collectionName,
        periods: months,
        documents: count,
      });
      const bucket = byReportMap.get(report)!;
      bucket.documents += count;
      bucket.properties.add(property._id);
      for (const month of months) {
        bucket.periods.add(month);
      }
    }

    byProperty.push({
      property_id: property._id,
      name: property.name,
      manager: property.manager,
      mongo_db: property.mongo_db,
      reports,
    });
  }

  const value: CoverageCache = {
    builtAt: new Date().toISOString(),
    properties: PROPERTIES,
    reports: REPORT_TYPES,
    documents,
    byProperty,
    byReport: REPORT_TYPES.map((report) => {
      const current = byReportMap.get(report)!;
      return {
        report,
        documents: current.documents,
        properties: [...current.properties].sort(),
        periods: [...current.periods].sort(),
      };
    }),
  };

  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}
