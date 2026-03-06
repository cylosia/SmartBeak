/**
 * Phase 3B — Agent Executor
 *
 * Core orchestration engine for multi-agent workflow execution.
 * Interprets a workflow graph (nodes + edges), executes each agent node
 * in topological order, passes outputs between nodes, and streams
 * progress events back to the caller.
 *
 * Supports:
 * - Sequential and parallel agent execution
 * - Per-agent memory injection
 * - Cost tracking per agent call
 * - Streaming progress via async generators
 */

import { ORPCError } from "@orpc/server";
import { generateText, streamText, openai, createAnthropic } from "@repo/ai";
import { logger } from "@repo/logs";
import {
  getAgentById,
  updateAgentMemory,
  updateSession,
} from "@repo/database";
import type { AiAgentConfig, AiMemoryContext, WorkflowGraph, WorkflowNode } from "@repo/database";
import { calculateCostCents } from "@repo/database";
import { formatMemoryForPrompt } from "./agent-memory";
import { getEnabledTools } from "./agent-tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentExecutionEvent {
  type:
    | "session_start"
    | "node_start"
    | "node_stream"
    | "node_complete"
    | "session_complete"
    | "error";
  nodeId?: string;
  agentId?: string;
  agentName?: string;
  chunk?: string;
  output?: string;
  costCents?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCostCents?: number;
  error?: string;
}

export interface TokenUsageEntry {
  agentId: string;
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

// ─── Model Factory ────────────────────────────────────────────────────────────

function getModel(modelId: string) {
  if (modelId.startsWith("claude-")) {
    const anthropic = createAnthropic();
    return anthropic(modelId);
  }
  return openai(modelId);
}

// ─── Default System Prompts ───────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
  research: `You are an expert Research Agent. Your role is to:
1. Search for and synthesize information from multiple sources.
2. Extract key facts, statistics, and insights.
3. Identify credible sources and note any conflicting information.
4. Produce a structured research brief with citations.
Be thorough, accurate, and cite your sources.`,

  writer: `You are an expert Writer Agent. Your role is to:
1. Transform research briefs and outlines into compelling, well-structured content.
2. Write in a clear, engaging, and authoritative voice.
3. Optimize for readability (short paragraphs, active voice, strong headlines).
4. Ensure the content is original, valuable, and SEO-friendly.
Produce publication-ready content.`,

  editor: `You are an expert Editor Agent. Your role is to:
1. Review content for clarity, accuracy, and flow.
2. Improve sentence structure, word choice, and transitions.
3. Check for factual consistency and logical coherence.
4. Optimize for the target audience and SEO.
Return the improved version with a brief summary of changes made.`,

  custom: `You are a helpful AI assistant. Complete the task provided to the best of your ability.`,
};

// ─── Topological Sort ─────────────────────────────────────────────────────────

function topologicalSort(graph: WorkflowGraph): WorkflowNode[] {
  const { nodes, edges } = graph;
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighborId of adjacency.get(node.id) ?? []) {
      const newDegree = (inDegree.get(neighborId) ?? 1) - 1;
      inDegree.set(neighborId, newDegree);
      if (newDegree === 0) {
        const neighborNode = nodes.find((n) => n.id === neighborId);
        if (neighborNode) queue.push(neighborNode);
      }
    }
  }

  return sorted;
}

// ─── Main Executor ────────────────────────────────────────────────────────────

/**
 * Executes a workflow graph and yields streaming events.
 *
 * @param sessionId - The ai_agent_sessions.id to update.
 * @param graph - The workflow graph to execute.
 * @param userPrompt - The user's input prompt.
 * @param context - Optional additional context.
 */
export async function* executeWorkflow(
  sessionId: string,
  graph: WorkflowGraph,
  userPrompt: string,
  context?: string,
): AsyncGenerator<AgentExecutionEvent> {
  const startTime = Date.now();
  const tokenUsage: TokenUsageEntry[] = [];
  const agentOutputs: Record<string, string> = {};
  let totalCostCents = 0;

  yield { type: "session_start" };

  // Update session to running
  await updateSession(sessionId, { status: "running" });

  try {
    const sortedNodes = topologicalSort(graph);
    const agentNodes = sortedNodes.filter((n) => n.type === "agent" && n.agentId);

    if (agentNodes.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Workflow has no agent nodes to execute." });
    }

    // Build context string from prior agent outputs
    let accumulatedContext = context ?? "";

    for (const node of agentNodes) {
      if (!node.agentId) continue;

      yield { type: "node_start", nodeId: node.id, agentName: node.label };

      // Load agent config from database
      const agent = await getAgentById(node.agentId);
      if (!agent) {
        yield {
          type: "error",
          nodeId: node.id,
          error: `Agent ${node.agentId} not found.`,
        };
        continue;
      }

      const config = agent.config as AiAgentConfig;
      const memory = agent.memoryContext as AiMemoryContext;

      // Build the full system prompt with memory injection
      const baseSystemPrompt =
        config.systemPrompt ||
        DEFAULT_SYSTEM_PROMPTS[agent.agentType] ||
        DEFAULT_SYSTEM_PROMPTS.custom;

      const memoryPrefix = formatMemoryForPrompt(memory);
      const systemPrompt = memoryPrefix
        ? `${memoryPrefix}\n---\n${baseSystemPrompt}`
        : baseSystemPrompt;

      // Build the user message with accumulated context from prior agents
      const userMessage =
        accumulatedContext.length > 0
          ? `## Prior Agent Context\n${accumulatedContext}\n\n## Your Task\n${userPrompt}`
          : userPrompt;

      const model = getModel(config.model ?? "gpt-4o-mini");
      const tools = getEnabledTools(config.tools ?? []);

      let fullOutput = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const result = streamText({
          model,
          system: systemPrompt,
          prompt: userMessage,
          maxOutputTokens: config.maxTokens ?? 4096,
          temperature: config.temperature ?? 0.7,
          tools: Object.keys(tools).length > 0 ? tools : undefined,
        });

        for await (const chunk of result.textStream) {
          fullOutput += chunk;
          yield {
            type: "node_stream",
            nodeId: node.id,
            agentId: agent.id,
            agentName: agent.name,
            chunk,
          };
        }

        const usage = await result.usage;
        inputTokens = usage?.inputTokens ?? 0;
        outputTokens = usage?.outputTokens ?? 0;
      } catch (streamErr) {
        // Fall back to non-streaming if streaming fails
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: userMessage,
          maxOutputTokens: config.maxTokens ?? 4096,
          temperature: config.temperature ?? 0.7,
        });
        fullOutput = result.text;
        inputTokens = result.usage?.inputTokens ?? 0;
        outputTokens = result.usage?.outputTokens ?? 0;
        yield {
          type: "node_stream",
          nodeId: node.id,
          agentId: agent.id,
          agentName: agent.name,
          chunk: fullOutput,
        };
      }

      const costCents = calculateCostCents(
        config.model ?? "gpt-4o-mini",
        inputTokens,
        outputTokens,
      );
      totalCostCents += costCents;

      tokenUsage.push({
        agentId: agent.id,
        agentName: agent.name,
        model: config.model ?? "gpt-4o-mini",
        inputTokens,
        outputTokens,
        costCents,
      });

      agentOutputs[agent.id] = fullOutput;

      // Accumulate context for the next agent
      accumulatedContext = `[${agent.name}]:\n${fullOutput}`;

      yield {
        type: "node_complete",
        nodeId: node.id,
        agentId: agent.id,
        agentName: agent.name,
        output: fullOutput,
        costCents,
        inputTokens,
        outputTokens,
      };

      // Asynchronously update agent memory (fire-and-forget, non-blocking)
      compressAndUpdateMemory(agent.id, memory, fullOutput, userPrompt).catch(
        (err) => {
          logger.warn(`[agent-executor] Failed to compress memory for agent ${agent.id}:`, err);
        },
      );
    }

    const durationMs = Date.now() - startTime;
    const finalOutput =
      agentOutputs[agentNodes[agentNodes.length - 1]?.agentId ?? ""] ?? "";
    const totalInputTokens = tokenUsage.reduce(
      (s, t) => s + t.inputTokens,
      0,
    );
    const totalOutputTokens = tokenUsage.reduce(
      (s, t) => s + t.outputTokens,
      0,
    );

    // Finalize session in database
    await updateSession(sessionId, {
      status: "completed",
      outputData: {
        result: finalOutput,
        agentOutputs,
        citations: [],
      },
      tokenUsage,
      costCents: totalCostCents,
      totalInputTokens,
      totalOutputTokens,
      durationMs,
      completedAt: new Date(),
    });

    yield {
      type: "session_complete",
      output: finalOutput,
      totalCostCents,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown execution error";

    await updateSession(sessionId, {
      status: "failed",
      errorMessage,
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    });

    yield { type: "error", error: errorMessage };
  }
}

// ─── Memory Update (async, non-blocking) ─────────────────────────────────────

async function compressAndUpdateMemory(
  agentId: string,
  existingMemory: AiMemoryContext,
  output: string,
  input: string,
): Promise<void> {
  try {
    const { compressSessionIntoMemory } = await import("./agent-memory");
    await compressSessionIntoMemory(agentId, existingMemory, output, input);
  } catch {
    // Memory update is best-effort; never block the main execution
  }
}
