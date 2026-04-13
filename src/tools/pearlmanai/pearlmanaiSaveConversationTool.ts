import { z } from "zod";
import type { Document } from "bson";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    PEARL_MANAI_LOGS_COLLECTION,
    PEARL_MANAI_LOGS_DATABASE,
} from "../../common/pearlmanaiConversationLog.js";
import type { ToolArgs, OperationType, ToolCategory, ToolExecutionContext } from "../tool.js";
import { MongoDBToolBase } from "../mongodb/mongodbTool.js";

export class PearlmanaiSaveConversationTool extends MongoDBToolBase {
    static toolName = "pearlmanai-save-conversation";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "create";

    public description =
        "Pearlman AI: saves a Claude conversation export to MongoDB database `logs`, collection `logs` (one document per call). Pass whatever the agent can provide: structured `messages` and/or a single `transcript` string. Requires write access — the MCP server must not be started with `--readOnly`.";

    public argsShape = {
        title: z
            .string()
            .optional()
            .describe("Optional label for this conversation (e.g. topic or project)."),
        messages: z
            .array(
                z.object({
                    role: z.string().describe("Message role, e.g. user, assistant."),
                    content: z.string().describe("Message body text."),
                })
            )
            .optional()
            .describe("Structured chat turns when the agent can provide them."),
        transcript: z
            .string()
            .optional()
            .describe("Full conversation as one string if not using structured messages."),
        metadata: z
            .record(z.unknown())
            .optional()
            .describe("Optional extra fields (e.g. client hint, session id as string)."),
    };

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        _context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const hasMessages = args.messages !== undefined && args.messages.length > 0;
        const hasTranscript = args.transcript !== undefined && args.transcript.trim().length > 0;
        if (!hasMessages && !hasTranscript) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Provide at least one of: `messages` (non-empty array) or `transcript` (non-empty string).",
                    },
                ],
                isError: true,
            };
        }

        const doc: Document = {
            savedAt: new Date().toISOString(),
            source: "claude-mcp",
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.messages !== undefined ? { messages: args.messages } : {}),
            ...(args.transcript !== undefined ? { transcript: args.transcript } : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
        };

        const provider = await this.ensureConnected();
        const result = await provider.insertMany(PEARL_MANAI_LOGS_DATABASE, PEARL_MANAI_LOGS_COLLECTION, [doc]);
        const insertedIds = Object.values(result.insertedIds);
        const insertedId = insertedIds[0];

        return {
            content: [
                {
                    type: "text",
                    text: `Saved conversation to \`${PEARL_MANAI_LOGS_DATABASE}.${PEARL_MANAI_LOGS_COLLECTION}\`. insertedCount=${result.insertedCount}, insertedId=${JSON.stringify(insertedId)}`,
                },
            ],
        };
    }
}
