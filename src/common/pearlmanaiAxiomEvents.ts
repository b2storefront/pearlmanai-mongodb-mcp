import { Axiom, type ClientOptions } from "@axiomhq/js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { redact } from "mongodb-redact";

/**
 * Pearlman AI fork: send structured usage events to Axiom when configured.
 *
 * Required: `AXIOM_TOKEN`
 * Optional: `AXIOM_DATASET` (default `mongodb-mcp`)
 *
 * If ingest returns **403 Forbidden**, common fixes:
 * - **Personal tokens** need `AXIOM_ORG_ID` (organization ID from Axiom settings).
 * - **EU region** deployments often need `AXIOM_URL=https://api.eu.axiom.co` and optionally
 *   `AXIOM_EDGE=eu-central-1.aws.edge.axiom.co` for ingest (see Axiom docs for your deployment).
 * - Ensure the token can **ingest** into the target dataset (API token scopes / dataset ACLs).
 *
 * Do not commit secrets; use environment variables or your process manager.
 */
let axiomClient: Axiom | null = null;
let shutdownFlushRegistered = false;

function getAxiomToken(): string | undefined {
    const t = process.env.AXIOM_TOKEN?.trim();
    return t || undefined;
}

/** When true, MCP tool I/O and connection events are logged to Axiom. */
export function isPearlmanaiAxiomEnabled(): boolean {
    return Boolean(getAxiomToken());
}

/** Enables MongoDB driver command monitoring (required for query-level Axiom events). */
export function shouldEnablePearlmanaiAxiomMongoMonitoring(): boolean {
    return isPearlmanaiAxiomEnabled();
}

export function getPearlmanaiAxiomDataset(): string {
    return process.env.AXIOM_DATASET?.trim() || "mongodb-mcp";
}

/** Format Axiom/fetch errors for journald (full message; 403 often truncates as "forbidd>"). */
function formatAxiomIngestError(err: unknown): string {
    if (err instanceof Error) {
        const bits: string[] = [`${err.name}: ${err.message}`];
        const extra = err as Error & {
            status?: number;
            statusCode?: number;
            body?: string;
            response?: { status?: number };
        };
        const status = extra.status ?? extra.statusCode ?? extra.response?.status;
        if (status !== undefined) {
            bits.push(`httpStatus=${String(status)}`);
        }
        if (typeof extra.body === "string" && extra.body.length > 0) {
            bits.push(`body=${extra.body.slice(0, 800)}`);
        }
        const cause = (err as Error & { cause?: unknown }).cause;
        if (cause !== undefined) {
            bits.push(`cause=${formatAxiomIngestError(cause)}`);
        }
        return bits.join(" | ");
    }
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

function buildAxiomClientOptions(token: string): ClientOptions {
    const orgId = process.env.AXIOM_ORG_ID?.trim();
    const url = process.env.AXIOM_URL?.trim();
    const edge = process.env.AXIOM_EDGE?.trim();
    const edgeUrl = process.env.AXIOM_EDGE_URL?.trim();

    return {
        token,
        ...(orgId ? { orgId } : {}),
        ...(url ? { url } : {}),
        ...(edge ? { edge } : {}),
        ...(edgeUrl ? { edgeUrl } : {}),
        onError: (err: unknown): void => {
            // stderr is appropriate here: logging subsystem must not depend on MCP loggers
            // eslint-disable-next-line no-console -- Axiom client has no injected logger
            console.error("[pearlmanai-mongodb-mcp] Axiom ingest error:", formatAxiomIngestError(err));
        },
    };
}

function getClient(): Axiom | null {
    const token = getAxiomToken();
    if (!token) {
        return null;
    }
    if (!axiomClient) {
        axiomClient = new Axiom(buildAxiomClientOptions(token));
    }
    return axiomClient;
}

function registerShutdownFlush(): void {
    if (shutdownFlushRegistered || !isPearlmanaiAxiomEnabled()) {
        return;
    }
    shutdownFlushRegistered = true;
    const run = (): void => {
        void flushPearlmanaiAxiomEvents();
    };
    process.once("beforeExit", run);
    process.once("SIGINT", run);
    process.once("SIGTERM", run);
}

const MAX_JSON_CHARS = 256_000;

function jsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
}

/** JSON-serialize values for Axiom fields with truncation and BigInt-safe replacer. */
export function serializeForPearlmanaiAxiomLog(value: unknown): string {
    try {
        const s = JSON.stringify(value, jsonReplacer);
        return s.length > MAX_JSON_CHARS ? `${s.slice(0, MAX_JSON_CHARS)}\n...[truncated]` : s;
    } catch {
        try {
            return JSON.stringify(String(value));
        } catch {
            return "[unserializable]";
        }
    }
}

/**
 * Ingest one event into the configured Axiom dataset. No-op if `AXIOM_TOKEN` is unset.
 * Adds `_time` and `source` for filtering in Axiom.
 */
export function emitPearlmanaiAxiomEvent(event: Record<string, unknown>): void {
    const client = getClient();
    if (!client) {
        return;
    }
    registerShutdownFlush();
    const dataset = getPearlmanaiAxiomDataset();
    client.ingest(dataset, [
        {
            ...event,
            _time: new Date().toISOString(),
            source: "pearlmanai-mongodb-mcp",
        },
    ]);
}

export async function flushPearlmanaiAxiomEvents(): Promise<void> {
    if (axiomClient) {
        await axiomClient.flush();
    }
}

const MAX_TOOL_TEXT_CHARS = 200_000;

/** Structured tool output for Axiom (large text truncated; binary/UI parts summarized by type only). */
export function summarizeCallToolResultForAxiom(result: CallToolResult): Record<string, unknown> {
    return {
        isError: result.isError ?? false,
        content: (result.content ?? []).map((part) => {
            if (part.type === "text") {
                const text = part.text ?? "";
                return {
                    type: "text" as const,
                    length: text.length,
                    text:
                        text.length > MAX_TOOL_TEXT_CHARS
                            ? `${text.slice(0, MAX_TOOL_TEXT_CHARS)}\n...[truncated]`
                            : text,
                };
            }
            return { type: part.type };
        }),
        structuredContentKeys:
            result.structuredContent && typeof result.structuredContent === "object"
                ? Object.keys(result.structuredContent as object)
                : undefined,
    };
}

export function emitPearlmanaiMcpToolCallEvent(params: {
    toolName: string;
    category: string;
    operationType: string;
    durationMs: number;
    status: "success" | "error" | "confirmation_declined";
    args: unknown;
    result: CallToolResult;
    executionError?: unknown;
}): void {
    const rawArgs =
        params.args !== null && typeof params.args === "object"
            ? (params.args as Record<string, unknown>)
            : { _value: params.args };
    const inputJson = serializeForPearlmanaiAxiomLog(redact(rawArgs));
    const base: Record<string, unknown> = {
        eventType: "mcp_tool_call",
        toolName: params.toolName,
        category: params.category,
        operationType: params.operationType,
        durationMs: params.durationMs,
        status: params.status,
        inputJson,
        resultSummary: summarizeCallToolResultForAxiom(params.result),
    };
    if (params.executionError !== undefined) {
        const e = params.executionError;
        base.executionError =
            e instanceof Error
                ? { name: e.name, message: e.message, stack: e.stack }
                : { detail: serializeForPearlmanaiAxiomLog(e) };
    }
    emitPearlmanaiAxiomEvent(base);
}
