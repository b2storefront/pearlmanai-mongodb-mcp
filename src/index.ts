import "dotenv/config";
import { FastMCP } from "fastmcp";

import {
  buildApiKeyAuthenticator,
  buildAuthProvider,
  buildToolAccessGuard,
  validateAuthConfig,
} from "./auth.js";
import { loadConfig } from "./config.js";
import { connectDb } from "./db.js";
import { MASTER_PROMPT } from "./prompt.js";
import { registerTools } from "./tools/register.js";

const config = loadConfig();
validateAuthConfig(config);

const authProvider = buildAuthProvider(config);
const authenticate = buildApiKeyAuthenticator(config.auth);
const toolAccess = buildToolAccessGuard(config);

const server = new FastMCP({
  name: "PearlmanAI Reports",
  version: "0.1.0",
  instructions: MASTER_PROMPT,
  ...(authProvider ? { auth: authProvider } : {}),
  ...(authenticate ? { authenticate } : {}),
});

registerTools(server, toolAccess);

await connectDb(config);

if (config.transport === "http") {
  if (config.auth.mode === "none") {
    console.warn(
      "[pearlmanai-reports-mcp] HTTP transport is running without MCP auth. " +
        "Set MCP_AUTH=oauth or MCP_AUTH=api_key before exposing this server.",
    );
  }

  server.start({
    transportType: "httpStream",
    httpStream: {
      host: config.httpHost,
      port: config.httpPort,
    },
  });

  const authSummary =
    config.auth.mode === "oauth"
      ? `OAuth (${config.auth.provider}) at ${config.auth.publicBaseUrl}`
      : config.auth.mode === "api_key"
        ? "API key"
        : "none";

  console.log(
    `[pearlmanai-reports-mcp] HTTP MCP listening on http://${config.httpHost}:${config.httpPort}/mcp (db: ${config.mongoDb}, auth: ${authSummary})`,
  );
} else {
  server.start({
    transportType: "stdio",
  });
}
