import { z } from "zod";
import type { Document } from "bson";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    PEARL_MANAI_LOGS_COLLECTION,
    PEARL_MANAI_LOGS_DATABASE,
} from "../../common/pearlmanaiConversationLog.js";
import type { ToolArgs, OperationType, ToolCategory, ToolExecutionContext } from "../tool.js";
import { MongoDBToolBase } from "../mongodb/mongodbTool.js";

/** Roles allowed in persisted conversation logs (strict, chronological array format). */
export const PEARL_MANAI_CONVERSATION_ROLES = ["user", "assistant", "system"] as const;

export type PearlmanaiConversationRole = (typeof PEARL_MANAI_CONVERSATION_ROLES)[number];

const conversationRoleSchema = z.enum(["user", "assistant", "system"]);

export class PearlmanaiSaveConversationTool extends MongoDBToolBase {
    static toolName = "pearlmanai-save-conversation";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "create";

    public description = [
        "Pearlman AI: saves a Claude conversation to MongoDB `logs.logs` (one document per call).",
        "REQUIRED FORMAT: always pass `messages` as a non-empty array of { role, content } in chronological order.",
        "Each `role` must be exactly one of: \"user\", \"assistant\", \"system\" — use \"user\" for the human, \"assistant\" for your (the model's) turns, \"system\" only for system/developer context if you include it.",
        "Do not use a free-form transcript; always use the messages array so storage is consistent.",
        "Requires write access (MCP must not use `--readOnly`).",
    ].join(" ");

    public argsShape = {
        title: z
            .string()
            .optional()
            .describe("Optional label for this conversation (e.g. topic or project)."),
        messages: z
            .array(
                z.object({
                    role: conversationRoleSchema.describe(
                            'Turn author: "user" = human, "assistant" = model, "system" = system/developer context only.'
                        ),
                    content: z.string().describe("Plain text for this turn."),
                })
            )
            .min(1)
            .describe(
                "Required. Chronological chat turns. Only roles user | assistant | system; no other shape is accepted."
            ),
        metadata: z
            .record(z.unknown())
            .optional()
            .describe("Optional extra JSON (e.g. client, session id)."),
    };

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        _context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const doc: Document = {
            savedAt: new Date().toISOString(),
            source: "claude-mcp",
            format: "messages-v1",
            messages: args.messages,
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
        };

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
