import type { IncomingMessage } from "node:http";

import {
  AzureProvider,
  GitHubProvider,
  GoogleProvider,
  OAuthProvider,
  requireAuth,
  type AuthProvider,
} from "fastmcp";
import { DiskStore } from "fastmcp/auth";

import type { AppConfig } from "./config.js";

export type ToolAccessGuard = (auth: Record<string, unknown> | undefined) => boolean;

function parseScopes(scopes: string | undefined): string[] | undefined {
  if (!scopes) {
    return undefined;
  }

  const parsed = scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : undefined;
}

function buildTokenStorage(config: AppConfig["auth"]) {
  if (config.tokenStorage !== "disk") {
    return undefined;
  }

  return new DiskStore({
    directory: config.tokenDir,
  });
}

function sharedProviderOptions(config: AppConfig["auth"]) {
  return {
    baseUrl: config.publicBaseUrl!,
    clientId: config.clientId!,
    clientSecret: config.clientSecret!,
    scopes: parseScopes(config.scopes),
    tokenStorage: buildTokenStorage(config),
    consentRequired: config.consentRequired,
    jwtSigningKey: config.jwtSigningKey,
    encryptionKey: config.encryptionKey,
  };
}

export function buildAuthProvider(
  config: AppConfig,
): AuthProvider | undefined {
  if (config.auth.mode !== "oauth") {
    return undefined;
  }

  const provider = config.auth.provider;
  const options = sharedProviderOptions(config.auth);

  switch (provider) {
    case "google":
      return new GoogleProvider(options);
    case "github":
      return new GitHubProvider(options);
    case "azure":
      return new AzureProvider({
        ...options,
        tenantId: config.auth.azureTenantId,
      });
    case "custom":
      return new OAuthProvider({
        ...options,
        authorizationEndpoint: config.auth.authorizationEndpoint!,
        tokenEndpoint: config.auth.tokenEndpoint!,
        tokenEndpointAuthMethod: config.auth.tokenEndpointAuthMethod,
      });
  }
}

export function buildApiKeyAuthenticator(config: AppConfig["auth"]) {
  if (config.mode !== "api_key") {
    return undefined;
  }

  const expectedKey = config.apiKey!;

  return async (request: IncomingMessage | undefined) => {
    const header = request?.headers.authorization;
    const apiKeyHeader = request?.headers["x-api-key"];

    const bearer =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : undefined;
    const apiKey =
      typeof apiKeyHeader === "string" ? apiKeyHeader : undefined;

    if (bearer !== expectedKey && apiKey !== expectedKey) {
      throw new Response(null, {
        status: 401,
        statusText: "Unauthorized",
      });
    }

    return {
      id: "api-key",
      method: bearer ? "bearer" : "x-api-key",
    };
  };
}

export function buildToolAccessGuard(config: AppConfig): ToolAccessGuard | undefined {
  if (config.auth.mode === "none") {
    return undefined;
  }

  const allowedEmails = config.auth.allowedEmails;

  if (!allowedEmails?.length) {
    return (auth) => requireAuth(auth);
  }

  const allowed = new Set(allowedEmails.map((email) => email.toLowerCase()));

  return (auth) => {
    if (!requireAuth(auth)) {
      return false;
    }

    const record = auth as Record<string, unknown> | undefined;
    const claims =
      record?.claims && typeof record.claims === "object"
        ? (record.claims as Record<string, unknown>)
        : undefined;
    const email =
      typeof record?.email === "string"
        ? record.email
        : typeof claims?.email === "string"
          ? claims.email
          : undefined;

    return email ? allowed.has(email.toLowerCase()) : false;
  };
}

export function validateAuthConfig(config: AppConfig): void {
  if (config.auth.mode === "none") {
    return;
  }

  if (config.transport !== "http") {
    console.warn(
      "[pearlmanai-reports-mcp] MCP auth is configured but MCP_TRANSPORT is not http. " +
        "Authentication only applies to the HTTP transport.",
    );
    return;
  }

  if (config.auth.mode === "oauth") {
    const missing: string[] = [];

    if (!config.auth.publicBaseUrl) {
      missing.push("MCP_PUBLIC_BASE_URL");
    }
    if (!config.auth.clientId) {
      missing.push("MCP_OAUTH_CLIENT_ID");
    }
    if (!config.auth.clientSecret) {
      missing.push("MCP_OAUTH_CLIENT_SECRET");
    }
    if (config.auth.provider === "custom") {
      if (!config.auth.authorizationEndpoint) {
        missing.push("MCP_OAUTH_AUTHORIZATION_ENDPOINT");
      }
      if (!config.auth.tokenEndpoint) {
        missing.push("MCP_OAUTH_TOKEN_ENDPOINT");
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `OAuth auth requires: ${missing.join(", ")}. ` +
          "Register an OAuth app with callback URL {MCP_PUBLIC_BASE_URL}/oauth/callback.",
      );
    }
  }

  if (config.auth.mode === "api_key" && !config.auth.apiKey) {
    throw new Error("API key auth requires MCP_API_KEY.");
  }
}
