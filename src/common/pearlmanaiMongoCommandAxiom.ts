import type { CommandFailedEvent, CommandStartedEvent, CommandSucceededEvent, MongoClient } from "mongodb";
import { redact } from "mongodb-redact";
import { EJSON } from "bson";
import { emitPearlmanaiAxiomEvent } from "./pearlmanaiAxiomEvents.js";

const MAX_REPLY_JSON_CHARS = 32_000;

function jsonReplacerBigInt(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }
    return value;
}

type PendingCommand = {
    commandName: string;
    databaseName: string;
    address: string;
    redactedCommandJson: string;
    startedAtMs: number;
};

function serializeReplySummary(reply: unknown): string {
    try {
        const s = JSON.stringify(reply, jsonReplacerBigInt);
        return s.length > MAX_REPLY_JSON_CHARS ? `${s.slice(0, MAX_REPLY_JSON_CHARS)}...[truncated]` : s;
    } catch {
        return "[unserializable reply]";
    }
}

function redactedCommandJson(command: CommandStartedEvent["command"]): string {
    try {
        const r = redact(EJSON.serialize(command as Record<string, unknown>));
        return JSON.stringify(r, jsonReplacerBigInt);
    } catch {
        return "[command serialize error]";
    }
}

/**
 * Attach Axiom logging for MongoDB wire protocol commands (requires `monitorCommands: true` on the client).
 * Returns a detach function; call before closing the client to avoid leaks.
 */
export function attachPearlmanaiMongoCommandAxiom(client: MongoClient): () => void {
    const pending = new Map<number, PendingCommand>();

    const onStarted = (e: CommandStartedEvent): void => {
        pending.set(e.requestId, {
            commandName: e.commandName,
            databaseName: e.databaseName,
            address: e.address,
            redactedCommandJson: redactedCommandJson(e.command),
            startedAtMs: Date.now(),
        });
    };

    const onSucceeded = (e: CommandSucceededEvent): void => {
        const p = pending.get(e.requestId);
        pending.delete(e.requestId);
        emitPearlmanaiAxiomEvent({
            eventType: "mongodb_command",
            outcome: "success",
            commandName: e.commandName,
            databaseName: e.databaseName,
            address: e.address,
            durationMs: e.duration,
            requestId: e.requestId,
            redactedCommandJson: p?.redactedCommandJson ?? "",
            replySummary: serializeReplySummary(e.reply),
        });
    };

    const onFailed = (e: CommandFailedEvent): void => {
        const p = pending.get(e.requestId);
        pending.delete(e.requestId);
        emitPearlmanaiAxiomEvent({
            eventType: "mongodb_command",
            outcome: "error",
            commandName: e.commandName,
            databaseName: e.databaseName,
            address: e.address,
            durationMs: e.duration,
            requestId: e.requestId,
            redactedCommandJson: p?.redactedCommandJson ?? "",
            errorName: e.failure.name,
            errorMessage: e.failure.message,
            errorStack: e.failure.stack,
        });
    };

    client.on("commandStarted", onStarted);
    client.on("commandSucceeded", onSucceeded);
    client.on("commandFailed", onFailed);

    return () => {
        client.off("commandStarted", onStarted);
        client.off("commandSucceeded", onSucceeded);
        client.off("commandFailed", onFailed);
        pending.clear();
    };
}
