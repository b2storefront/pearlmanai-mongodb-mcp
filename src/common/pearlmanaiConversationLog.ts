/**
 * Pearlman AI conversation persistence: single database and collection (same name: `logs`).
 * Hidden from the property/report guide listing.
 */

export const PEARL_MANAI_LOGS_DATABASE = "logs";
export const PEARL_MANAI_LOGS_COLLECTION = "logs";

/** Databases excluded from the pearlmanai-parsed-reports-guide inventory (not tenant “properties”). */
export const PEARL_MANAI_GUIDE_HIDDEN_DATABASES = new Set<string>([PEARL_MANAI_LOGS_DATABASE]);
