import { MongoClient, type Db } from "mongodb";

import type { AppConfig } from "./config.js";

let client: MongoClient | undefined;

export async function connectDb(config: AppConfig): Promise<MongoClient> {
  if (client) {
    return client;
  }

  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 20_000,
  });
  await client.connect();
  return client;
}

export function getClient(): MongoClient {
  if (!client) {
    throw new Error("MongoDB is not connected");
  }
  return client;
}

export function propertyDb(mongoDb: string): Db {
  return getClient().db(mongoDb);
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
}
