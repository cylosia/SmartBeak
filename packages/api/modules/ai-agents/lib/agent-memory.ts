/**
 * Phase 3B — Agent Memory Manager
 *
 * Manages long-context memory that persists across sessions and projects.
 * Uses a rolling summary strategy to keep memory compact while retaining
 * key facts and context learned over time.
 */

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { updateAgentMemory } from "@repo/database";
import type { AiMemoryContext } from "@repo/database";

const memoryModel = openai("gpt-4o-mini");

// ─── Memory Compression ───────────────────────────────────────────────────────

/**
 * Compresses a session's output into the agent's persistent memory.
 *
 * Strategy:
 * 1. Extract discrete facts from the session output.
 * 2. Merge with existing facts (deduplicate).
 * 3. Re-summarize the combined context to keep it concise.
 * 4. Persist the updated memory to the database.
 */
export async function compressSessionIntoMemory(
  agentId: string,
  existingMemory: AiMemoryContext,
  sessionOutput: string,
  sessionInput: string,
): Promise<AiMemoryContext> {
  const existingSummary = existingMemory.summary || "No prior context.";
  const existingFacts = existingMemory.facts || [];

  const prompt = `You are a memory manager for an AI agent. Your job is to update the agent's persistent memory based on a new session.

EXISTING MEMORY SUMMARY:
${existingSummary}

EXISTING KNOWN FACTS (${existingFacts.length}):
${existingFacts.slice(0, 20).join("\n")}

NEW SESSION INPUT:
${sessionInput.slice(0, 1000)}

NEW SESSION OUTPUT:
${sessionOutput.slice(0, 2000)}

Based on the new session, update the memory. Return a JSON object with:
1. "summary": A concise 2-3 sentence summary of what the agent knows and has done (max 500 chars).
2. "facts": An array of up to 20 discrete, reusable facts learned (short bullet-point style strings).

Respond ONLY with valid JSON, no markdown.`;

  try {
    const { text } = await generateText({
      model: memoryModel,
      prompt,
      maxTokens: 1024,
      temperature: 0.2,
    });

    const parsed = JSON.parse(text) as {
      summary: string;
      facts: string[];
    };

    const updatedMemory: AiMemoryContext = {
      summary: parsed.summary?.slice(0, 500) ?? existingSummary,
      facts: [...new Set([...existingFacts, ...(parsed.facts ?? [])])].slice(
        0,
        20,
      ),
      lastUpdatedAt: new Date().toISOString(),
    };

    // Persist to database
    await updateAgentMemory(agentId, updatedMemory);
    return updatedMemory;
  } catch {
    // If memory compression fails, return existing memory unchanged
    return existingMemory;
  }
}

// ─── Memory Formatting ────────────────────────────────────────────────────────

/**
 * Formats an agent's memory context into a system prompt prefix.
 * This is injected at the start of every agent call to provide continuity.
 */
export function formatMemoryForPrompt(memory: AiMemoryContext): string {
  if (!memory.summary && (!memory.facts || memory.facts.length === 0)) {
    return "";
  }

  const parts: string[] = ["## Agent Memory (Persistent Context)\n"];

  if (memory.summary) {
    parts.push(`**Summary:** ${memory.summary}\n`);
  }

  if (memory.facts && memory.facts.length > 0) {
    parts.push("**Known Facts:**");
    for (const fact of memory.facts.slice(0, 10)) {
      parts.push(`- ${fact}`);
    }
    parts.push("");
  }

  if (memory.lastUpdatedAt) {
    parts.push(
      `*Memory last updated: ${new Date(memory.lastUpdatedAt).toLocaleDateString()}*\n`,
    );
  }

  return parts.join("\n");
}

// ─── Memory Snapshot ─────────────────────────────────────────────────────────

/**
 * Creates a snapshot of memory for multiple agents, used as the session's
 * initial memory state (stored in ai_agent_sessions.memory_state).
 */
export function createMemorySnapshot(
  agents: Array<{ id: string; memoryContext: unknown }>,
): Record<string, AiMemoryContext> {
  const snapshot: Record<string, AiMemoryContext> = {};
  for (const agent of agents) {
    if (agent.memoryContext && typeof agent.memoryContext === "object") {
      snapshot[agent.id] = agent.memoryContext as AiMemoryContext;
    }
  }
  return snapshot;
}
