import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Minimal shape for MCP `tools/call` handler `extra` (see `@modelcontextprotocol/sdk` RequestHandlerExtra).
 * Used for Axiom correlation without importing tool.ts (avoid circular deps).
 */
export interface PearlmanaiMcpExecutionContextLike {
    signal: AbortSignal;
    /** MCP transport session (Streamable HTTP `mcp-session-id`, etc.). */
    sessionId?: string;
    /** JSON-RPC request id for this `tools/call`. */
    requestId?: string | number;
    requestInfo?: { headers?: Record<string, unknown> };
    /** Populated when MCP OAuth / bearer auth is enabled — never log `token`. */
    authInfo?: {
        clientId: string;
        scopes: string[];
        expiresAt?: number;
        extra?: Record<string, unknown>;
    };
    _meta?: Record<string, unknown>;
}

/** Fields attached to Axiom events and MongoDB command logs (same tool invocation). */
export type PearlmanaiMcpAxiomCorrelation = {
    mcpSessionId?: string;
    mcpJsonRpcRequestId?: string | number;
    oauthClientId?: string;
    oauthScopes?: string;
    /** From OAuth `extra` claims or allowlisted HTTP headers — not a verified identity guarantee. */
    userDisplayHint?: string;
    /** Truncated JSON of MCP `_meta` on the request (clients may put conversation id here). */
    mcpRequestMetaSummary?: string;
};

export const pearlmanaiMcpAsyncContext = new AsyncLocalStorage<PearlmanaiMcpAxiomCorrelation>();

const DEFAULT_USER_HEADER_NAMES = ["x-pearlman-user", "x-forwarded-user", "x-forwarded-preferred-username"];

function envUserHeaderList(): string[] {
    const raw = process.env.AXIOM_MCP_USER_HEADERS?.trim();
    if (!raw) {
        return DEFAULT_USER_HEADER_NAMES;
    }
    return raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
    if (!headers) {
        return undefined;
    }
    const want = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() !== want) {
            continue;
        }
        if (Array.isArray(v)) {
            const first: unknown = v[0];
            if (first === undefined || first === null) {
                return undefined;
            }
            return typeof first === "string" ? first : JSON.stringify(first);
        }
        if (v === undefined || v === null) {
            return undefined;
        }
        return typeof v === "string" ? v : JSON.stringify(v);
    }
    return undefined;
}

function pickUserFromAuthExtra(extra: Record<string, unknown> | undefined): string | undefined {
    if (!extra) {
        return undefined;
    }
    const keys = ["preferred_username", "name", "email", "username", "user_name", "nickname", "sub"];
    for (const k of keys) {
        const v: unknown = extra[k];
        if (typeof v === "string" && v.trim()) {
            return v.trim().slice(0, 256);
        }
    }
    return undefined;
}

function pickUserFromHeaders(context: PearlmanaiMcpExecutionContextLike): string | undefined {
    const h = context.requestInfo?.headers;
    if (!h) {
        return undefined;
    }
    for (const name of envUserHeaderList()) {
        const v = headerValue(h, name);
        if (v?.trim()) {
            return v.trim().slice(0, 256);
        }
    }
    return undefined;
}

const MAX_META_JSON = 4000;

export function buildPearlmanaiMcpCorrelation(
    context: PearlmanaiMcpExecutionContextLike
): PearlmanaiMcpAxiomCorrelation {
    const auth = context.authInfo;
    const userFromAuth = auth?.extra ? pickUserFromAuthExtra(auth.extra) : undefined;
    const userFromHeaders = pickUserFromHeaders(context);
    let mcpRequestMetaSummary: string | undefined;
    if (context._meta && typeof context._meta === "object" && Object.keys(context._meta).length > 0) {
        try {
            const s = JSON.stringify(context._meta);
            mcpRequestMetaSummary = s.length > MAX_META_JSON ? `${s.slice(0, MAX_META_JSON)}...[truncated]` : s;
        } catch {
            mcpRequestMetaSummary = "[unserializable _meta]";
        }
    }
    return {
        mcpSessionId: context.sessionId,
        mcpJsonRpcRequestId: context.requestId,
        oauthClientId: auth?.clientId,
        oauthScopes: auth?.scopes?.length ? auth.scopes.join(" ") : undefined,
        userDisplayHint: userFromAuth ?? userFromHeaders,
        mcpRequestMetaSummary,
    };
}

export function pearlmanaiMcpCorrelationToEventFields(c: PearlmanaiMcpAxiomCorrelation): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (c.mcpSessionId !== undefined) {
        out.mcpSessionId = c.mcpSessionId;
    }
    if (c.mcpJsonRpcRequestId !== undefined) {
        out.mcpJsonRpcRequestId = c.mcpJsonRpcRequestId;
    }
    if (c.oauthClientId !== undefined) {
        out.oauthClientId = c.oauthClientId;
    }
    if (c.oauthScopes !== undefined) {
        out.oauthScopes = c.oauthScopes;
    }
    if (c.userDisplayHint !== undefined) {
        out.userDisplayHint = c.userDisplayHint;
    }
    if (c.mcpRequestMetaSummary !== undefined) {
        out.mcpRequestMetaSummary = c.mcpRequestMetaSummary;
    }
    return out;
}
