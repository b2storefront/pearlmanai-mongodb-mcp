import { z } from "zod";

const oauthProviderSchema = z.enum(["google", "github", "azure", "custom"]);

const authConfigSchema = z.object({
  mode: z.enum(["none", "oauth", "api_key"]).default("none"),
  publicBaseUrl: z.string().url().optional(),
  provider: oauthProviderSchema.optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  scopes: z.string().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  tokenEndpointAuthMethod: z
    .enum(["client_secret_basic", "client_secret_post"])
    .optional(),
  azureTenantId: z.string().min(1).default("common"),
  allowedEmails: z.array(z.string().email()).optional(),
  apiKey: z.string().min(1).optional(),
  consentRequired: z.boolean().default(true),
  tokenStorage: z.enum(["memory", "disk"]).default("memory"),
  tokenDir: z.string().min(1).default(".oauth-tokens"),
  jwtSigningKey: z.string().min(1).optional(),
  encryptionKey: z.string().min(1).optional(),
});

const configSchema = z.object({
  mongoUri: z.string().min(1),
  mongoDb: z.string().min(1).default("pearlman_financials"),
  transport: z.enum(["stdio", "http"]).default("stdio"),
  httpPort: z.coerce.number().int().min(1).max(65535).default(8092),
  httpHost: z.string().min(1).default("127.0.0.1"),
  auth: authConfigSchema,
});

export type AppConfig = z.infer<typeof configSchema>;

function readEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined && value !== "") {
    return value;
  }
  return fallback;
}

function parseAllowedEmails(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const emails = value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  return emails.length > 0 ? emails : undefined;
}

export function loadConfig(): AppConfig {
  const parsed = configSchema.safeParse({
    mongoUri: readEnv("MONGODB_URI") ?? readEnv("MDB_MCP_CONNECTION_STRING"),
    mongoDb: readEnv("MONGODB_DB", "pearlman_financials"),
    transport: readEnv("MCP_TRANSPORT", "stdio"),
    httpPort: readEnv("MCP_HTTP_PORT") ?? readEnv("MDB_MCP_HTTP_PORT", "8092"),
    httpHost: readEnv("MCP_HTTP_HOST") ?? readEnv("MDB_MCP_HTTP_HOST", "127.0.0.1"),
    auth: {
      mode: readEnv("MCP_AUTH", "none"),
      publicBaseUrl: readEnv("MCP_PUBLIC_BASE_URL"),
      provider: readEnv("MCP_OAUTH_PROVIDER"),
      clientId: readEnv("MCP_OAUTH_CLIENT_ID"),
      clientSecret: readEnv("MCP_OAUTH_CLIENT_SECRET"),
      scopes: readEnv("MCP_OAUTH_SCOPES"),
      authorizationEndpoint: readEnv("MCP_OAUTH_AUTHORIZATION_ENDPOINT"),
      tokenEndpoint: readEnv("MCP_OAUTH_TOKEN_ENDPOINT"),
      tokenEndpointAuthMethod: readEnv("MCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHOD"),
      azureTenantId: readEnv("MCP_OAUTH_AZURE_TENANT_ID", "common"),
      allowedEmails: parseAllowedEmails(readEnv("MCP_OAUTH_ALLOWED_EMAILS")),
      apiKey: readEnv("MCP_API_KEY"),
      consentRequired: readEnv("MCP_OAUTH_CONSENT_REQUIRED", "true") !== "false",
      tokenStorage: readEnv("MCP_OAUTH_TOKEN_STORAGE", "memory"),
      tokenDir: readEnv("MCP_OAUTH_TOKEN_DIR", ".oauth-tokens"),
      jwtSigningKey: readEnv("MCP_OAUTH_JWT_SIGNING_KEY"),
      encryptionKey: readEnv("MCP_OAUTH_ENCRYPTION_KEY"),
    },
  });

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${message}`);
  }

  const config = parsed.data;

  if (config.auth.mode === "oauth" && !config.auth.provider) {
    throw new Error(
      "OAuth auth requires MCP_OAUTH_PROVIDER (google, github, azure, or custom).",
    );
  }

  return config;
}
