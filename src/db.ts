import { MongoClient, type Db } from "mongodb";

import type { AppConfig } from "./config.js";

let client: MongoClient | undefined;
let db: Db | undefined;

export async function connectDb(config: AppConfig): Promise<Db> {
  if (db) {
    return db;
  }

  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 20_000,
  });
  await client.connect();
  db = client.db(config.mongoDb);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB is not connected");
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}
