import type { Db } from "mongodb";

import { PROPERTIES, REPORT_TYPES, type ReportType } from "../catalog.js";

export interface CoverageCache {
  builtAt: string;
  properties: typeof PROPERTIES;
  reports: ReportType[];
  documents: number;
  byProperty: {
    property_id: string;
    name: string;
    manager: string;
    reports: {
      report: ReportType;
      bases: string[];
      periods: string[];
      documents: number;
      rows: number;
    }[];
  }[];
  byReport: {
    report: ReportType;
    documents: number;
    rows: number;
    properties: string[];
    periods: string[];
    bases: string[];
  }[];
}

const TTL_MS = 5 * 60 * 1000;
let cache: { value: CoverageCache; expires: number } | undefined;

export function invalidateCoverage(): void {
  cache = undefined;
}

export async function getCoverage(db: Db): Promise<CoverageCache> {
  if (cache && cache.expires > Date.now()) {
    return cache.value;
  }

  const documents = await db
    .collection("documents")
    .find(
      {},
      {
        projection: {
          property_id: 1,
          report: 1,
          basis: 1,
          period: 1,
          as_of: 1,
          row_count: 1,
        },
      },
    )
    .toArray();

  const byPropertyMap = new Map<
    string,
    Map<string, { bases: Set<string>; periods: Set<string>; documents: number; rows: number }>
  >();
  const byReportMap = new Map<
    ReportType,
    { documents: number; rows: number; properties: Set<string>; periods: Set<string>; bases: Set<string> }
  >();

  for (const report of REPORT_TYPES) {
    byReportMap.set(report, {
      documents: 0,
      rows: 0,
      properties: new Set(),
      periods: new Set(),
      bases: new Set(),
    });
  }

  for (const doc of documents) {
    const report = doc.report as ReportType;
    const period = (doc.period ?? doc.as_of) as string | null;
    const bucket =
      byPropertyMap.get(doc.property_id) ??
      new Map<string, { bases: Set<string>; periods: Set<string>; documents: number; rows: number }>();
    const current = bucket.get(report) ?? {
      bases: new Set<string>(),
      periods: new Set<string>(),
      documents: 0,
      rows: 0,
    };
    current.documents += 1;
    current.rows += Number(doc.row_count ?? 0);
    if (doc.basis) {
      current.bases.add(doc.basis);
    }
    if (period) {
      current.periods.add(period);
    }
    bucket.set(report, current);
    byPropertyMap.set(doc.property_id, bucket);

    const reportBucket = byReportMap.get(report);
    if (reportBucket) {
      reportBucket.documents += 1;
      reportBucket.rows += Number(doc.row_count ?? 0);
      reportBucket.properties.add(doc.property_id);
      if (period) {
        reportBucket.periods.add(period);
      }
      if (doc.basis) {
        reportBucket.bases.add(doc.basis);
      }
    }
  }

  const value: CoverageCache = {
    builtAt: new Date().toISOString(),
    properties: PROPERTIES,
    reports: REPORT_TYPES,
    documents: documents.length,
    byProperty: PROPERTIES.map((property) => {
      const bucket = byPropertyMap.get(property._id);
      return {
        property_id: property._id,
        name: property.name,
        manager: property.manager,
        reports: REPORT_TYPES.filter((report) => bucket?.has(report)).map((report) => {
          const current = bucket!.get(report)!;
          return {
            report,
            bases: [...current.bases].sort(),
            periods: [...current.periods].sort(),
            documents: current.documents,
            rows: current.rows,
          };
        }),
      };
    }),
    byReport: REPORT_TYPES.map((report) => {
      const current = byReportMap.get(report)!;
      return {
        report,
        documents: current.documents,
        rows: current.rows,
        properties: [...current.properties].sort(),
        periods: [...current.periods].sort(),
        bases: [...current.bases].sort(),
      };
    }),
  };

  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}
