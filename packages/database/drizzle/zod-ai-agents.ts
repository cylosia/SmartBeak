/**
 * SmartBeak Phase 3B — AI Agents Zod validation schemas.
 *
 * Provides strongly-typed, validated schemas for all AI agent operations.
 * Used by both the API layer (input validation) and the frontend (form validation).
 */

import { z } from "zod";

// ─── Agent Config ─────────────────────────────────────────────────────────────

export const AiAgentToolEnum = z.enum([
  "web_search",
  "read_url",
  "content_read",
  "seo_data",
  "image_generate",
  "fact_check",
]);

export const AiAgentConfigSchema = z.object({
  /** AI model identifier. */
  model: z
    .string()
    .default("gpt-4o-mini")
    .describe("Model identifier, e.g. gpt-4o-mini or claude-3-5-sonnet-20241022"),
  /** Full system prompt for this agent. */
  systemPrompt: z.string().default("You are a helpful AI assistant."),
  /** Sampling temperature (0.0 = deterministic, 1.0 = creative). */
  temperature: z.number().min(0).max(1).default(0.7),
  /** Maximum output tokens per call. */
  maxTokens: z.number().int().min(256).max(32768).default(4096),
  /** Enabled tool names for this agent. */
  tools: z.array(AiAgentToolEnum).default([]),
});

export type AiAgentConfig = z.infer<typeof AiAgentConfigSchema>;

// ─── Memory Context ───────────────────────────────────────────────────────────

export const AiMemoryContextSchema = z.object({
  /** Rolling summary of past interactions. */
  summary: z.string().default(""),
  /** Discrete facts learned across sessions. */
  facts: z.array(z.string()).default([]),
  /** ISO date of the last memory update. */
  lastUpdatedAt: z.string().optional(),
});

export type AiMemoryContext = z.infer<typeof AiMemoryContextSchema>;

// ─── Workflow Graph ───────────────────────────────────────────────────────────

export const WorkflowNodeTypeEnum = z.enum([
  "agent",
  "input",
  "output",
  "condition",
]);

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: WorkflowNodeTypeEnum,
  /** Reference to an ai_agents.id for "agent" type nodes. */
  agentId: z.string().uuid().optional(),
  label: z.string(),
  /** Node-specific configuration (overrides agent defaults). */
  config: z.record(z.string(), z.unknown()).default({}),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  /** Condition expression for conditional edges. */
  condition: z.string().optional(),
});

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

// ─── Session Data ─────────────────────────────────────────────────────────────

export const SessionInputDataSchema = z.object({
  prompt: z.string().min(1),
  context: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const AgentTokenUsageSchema = z.object({
  agentId: z.string(),
  agentName: z.string().optional(),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Cost in USD cents. */
  costCents: z.number().int(),
});

export const SessionOutputDataSchema = z.object({
  result: z.string(),
  /** Per-agent output text keyed by agentId. */
  agentOutputs: z.record(z.string(), z.string()).default({}),
  citations: z.array(z.string()).optional(),
});

export type SessionInputData = z.infer<typeof SessionInputDataSchema>;
export type SessionOutputData = z.infer<typeof SessionOutputDataSchema>;
export type AgentTokenUsage = z.infer<typeof AgentTokenUsageSchema>;

// ─── API Input Schemas ────────────────────────────────────────────────────────

export const CreateAiAgentInputSchema = z.object({
  organizationSlug: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  agentType: z.enum(["research", "writer", "editor", "custom"]).default("custom"),
  config: AiAgentConfigSchema.optional(),
});

export const UpdateAiAgentInputSchema = z.object({
  organizationSlug: z.string(),
  agentId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  config: AiAgentConfigSchema.partial().optional(),
  isActive: z.boolean().optional(),
});

export const CreateWorkflowInputSchema = z.object({
  organizationSlug: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  stepsJson: WorkflowGraphSchema.optional(),
});

export const UpdateWorkflowInputSchema = z.object({
  organizationSlug: z.string(),
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  stepsJson: WorkflowGraphSchema.optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export const RunWorkflowInputSchema = z.object({
  organizationSlug: z.string(),
  workflowId: z.string().uuid(),
  prompt: z.string().min(1).max(10000),
  context: z.string().max(50000).optional(),
});

export const GetAnalyticsInputSchema = z.object({
  organizationSlug: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agentId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
});

// ─── Cost calculation helpers ─────────────────────────────────────────────────

/** Approximate cost in USD cents per 1M tokens for known models. */
export const MODEL_COST_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-4o-mini": { input: 15, output: 60 },
  "gpt-4o": { input: 250, output: 1000 },
  "claude-3-5-sonnet-20241022": { input: 300, output: 1500 },
  "claude-3-haiku-20240307": { input: 25, output: 125 },
  "claude-3-opus-20240229": { input: 1500, output: 7500 },
};

/**
 * Calculates the cost in USD cents for a given number of tokens.
 */
export function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = MODEL_COST_PER_1M_TOKENS[model] ?? { input: 100, output: 300 };
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return Math.ceil(inputCost + outputCost);
}
