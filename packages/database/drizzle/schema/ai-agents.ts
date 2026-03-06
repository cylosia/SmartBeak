/**
 * SmartBeak Phase 3B — Advanced AI Agents schema extension.
 *
 * These tables are ADDITIVE — the locked v9 smartbeak.ts schema and the
 * Phase 3A enterprise.ts schema are NOT modified.
 * All tables are prefixed with `ai_` for clear namespacing.
 *
 * Covers:
 *  - ai_agents: reusable agent definitions with typed configs
 *  - ai_workflows: no-code workflow graphs chaining multiple agents
 *  - ai_agent_sessions: per-execution logs with memory state and cost tracking
 */

import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./smartbeak";

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * Agent types supported by the platform.
 * - research: Searches the web, summarizes sources, extracts facts.
 * - writer: Generates long-form content from a brief or outline.
 * - editor: Reviews and improves existing content for clarity and SEO.
 * - custom: User-defined agent with a fully custom system prompt.
 */
export const aiAgentTypeEnum = pgEnum("ai_agent_type", [
	"research",
	"writer",
	"editor",
	"custom",
]);

/**
 * Workflow execution status.
 */
export const aiWorkflowStatusEnum = pgEnum("ai_workflow_status", [
	"draft",
	"active",
	"archived",
]);

/**
 * Session execution status.
 */
export const aiSessionStatusEnum = pgEnum("ai_session_status", [
	"pending",
	"running",
	"completed",
	"failed",
	"cancelled",
]);

// ─── 1. AI Agents ─────────────────────────────────────────────────────────────

/**
 * ai_agents — Reusable agent definitions scoped to an organization.
 *
 * Each agent has a type, a configuration object (model, system prompt,
 * temperature, tools), and a persistent memory context that is carried
 * forward across sessions.
 */
export const aiAgents = pgTable(
	"ai_agents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** Human-readable display name for the agent. */
		name: text("name").notNull(),
		/** Short description of what this agent does. */
		description: text("description"),
		/** Typed agent role that determines default behavior and available tools. */
		agentType: aiAgentTypeEnum("agent_type").notNull().default("custom"),
		/**
		 * JSON configuration for the agent.
		 * Shape: {
		 *   model: string;           // e.g. "claude-3-5-sonnet-20241022"
		 *   systemPrompt: string;
		 *   temperature: number;     // 0.0–1.0
		 *   maxTokens: number;
		 *   tools: string[];         // enabled tool names
		 * }
		 */
		config: jsonb("config").notNull().default({}),
		/**
		 * Long-context memory that persists across sessions.
		 * Stores a rolling summary of past interactions and learned facts.
		 * Shape: {
		 *   summary: string;
		 *   facts: string[];
		 *   lastUpdatedAt: string;   // ISO date
		 * }
		 */
		memoryContext: jsonb("memory_context").default({}),
		/** Whether this agent is visible and usable in the workflow builder. */
		isActive: boolean("is_active").notNull().default(true),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ai_agents_org_id_idx").on(table.orgId),
		index("ai_agents_type_idx").on(table.agentType),
	],
);

// ─── 2. AI Workflows ──────────────────────────────────────────────────────────

/**
 * ai_workflows — No-code workflow graphs that chain multiple agents.
 *
 * The `stepsJson` field stores the full visual graph as a JSON object,
 * including node positions, edge connections, and per-node configuration.
 * This allows the workflow builder UI to serialize/deserialize the graph
 * without a separate migration for every new workflow shape.
 *
 * Shape of stepsJson:
 * {
 *   nodes: Array<{
 *     id: string;
 *     type: "agent" | "input" | "output" | "condition";
 *     agentId?: string;
 *     label: string;
 *     config: Record<string, unknown>;
 *     position: { x: number; y: number };
 *   }>;
 *   edges: Array<{
 *     id: string;
 *     source: string;
 *     target: string;
 *     label?: string;
 *   }>;
 * }
 */
export const aiWorkflows = pgTable(
	"ai_workflows",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** Human-readable workflow name. */
		name: text("name").notNull(),
		/** Optional description of what this workflow produces. */
		description: text("description"),
		/** Serialized visual graph (nodes + edges). */
		stepsJson: jsonb("steps_json")
			.notNull()
			.default({ nodes: [], edges: [] }),
		/** Workflow lifecycle status. */
		status: aiWorkflowStatusEnum("status").notNull().default("draft"),
		/** Estimated token cost per run in USD cents (informational). */
		estimatedCostCents: integer("estimated_cost_cents").default(0),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ai_workflows_org_id_idx").on(table.orgId),
		index("ai_workflows_status_idx").on(table.status),
	],
);

// ─── 3. AI Agent Sessions ─────────────────────────────────────────────────────

/**
 * ai_agent_sessions — Per-execution log for every workflow run.
 *
 * Each session captures:
 * - Which workflow was executed.
 * - The full memory state at the time of execution (snapshot for replay).
 * - The actual cost in USD cents (calculated from token usage).
 * - The final output produced by the workflow.
 * - Timing and error information for analytics.
 */
export const aiAgentSessions = pgTable(
	"ai_agent_sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** The workflow that was executed. Null for ad-hoc single-agent runs. */
		workflowId: uuid("workflow_id").references(() => aiWorkflows.id, {
			onDelete: "set null",
		}),
		/** The user who triggered this session. */
		triggeredBy: text("triggered_by").notNull(),
		/** Execution status. */
		status: aiSessionStatusEnum("status").notNull().default("pending"),
		/**
		 * Snapshot of the memory state at the start of this session.
		 * Shape: Record<agentId, { summary: string; facts: string[] }>
		 */
		memoryState: jsonb("memory_state").default({}),
		/**
		 * The input provided to the workflow at execution time.
		 * Shape: { prompt: string; context?: string; options?: Record<string, unknown> }
		 */
		inputData: jsonb("input_data").default({}),
		/**
		 * The final output of the workflow.
		 * Shape: { result: string; agentOutputs: Record<agentId, string>; citations?: string[] }
		 */
		outputData: jsonb("output_data").default({}),
		/**
		 * Per-agent token usage breakdown.
		 * Shape: Array<{ agentId: string; model: string; inputTokens: number; outputTokens: number; costCents: number }>
		 */
		tokenUsage: jsonb("token_usage").default([]),
		/** Total cost of this session in USD cents. */
		costCents: integer("cost_cents").notNull().default(0),
		/** Total input tokens consumed across all agents. */
		totalInputTokens: integer("total_input_tokens").default(0),
		/** Total output tokens generated across all agents. */
		totalOutputTokens: integer("total_output_tokens").default(0),
		/** Duration of the session in milliseconds. */
		durationMs: integer("duration_ms"),
		/** Error message if the session failed. */
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ai_agent_sessions_org_id_idx").on(table.orgId),
		index("ai_agent_sessions_workflow_id_idx").on(table.workflowId),
		index("ai_agent_sessions_status_idx").on(table.status),
		index("ai_agent_sessions_created_at_idx").on(table.createdAt),
		index("ai_agent_sessions_triggered_by_idx").on(table.triggeredBy),
	],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const aiAgentsRelations = relations(aiAgents, ({ one }) => ({
	organization: one(organizations, {
		fields: [aiAgents.orgId],
		references: [organizations.id],
	}),
}));

export const aiWorkflowsRelations = relations(aiWorkflows, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [aiWorkflows.orgId],
		references: [organizations.id],
	}),
	sessions: many(aiAgentSessions),
}));

export const aiAgentSessionsRelations = relations(
	aiAgentSessions,
	({ one }) => ({
		organization: one(organizations, {
			fields: [aiAgentSessions.orgId],
			references: [organizations.id],
		}),
		workflow: one(aiWorkflows, {
			fields: [aiAgentSessions.workflowId],
			references: [aiWorkflows.id],
		}),
	}),
);
