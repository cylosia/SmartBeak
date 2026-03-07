import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({
	calculateCostCents: vi.fn().mockReturnValue(0),
	getAgentsByIds: vi.fn().mockResolvedValue([]),
	updateSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@repo/ai", () => ({
	createAnthropic: vi.fn(),
	generateText: vi.fn(),
	openai: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn().mockReturnValue({}),
}));
vi.mock("@repo/logs", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../infrastructure/ai-budget", () => ({
	checkAiBudget: vi.fn().mockResolvedValue(undefined),
	recordAiSpend: vi.fn().mockResolvedValue(undefined),
}));

import type { WorkflowGraph } from "@repo/database";
import {
	executeWorkflow,
	MAX_AGENTS_PER_WORKFLOW,
	topologicalSort,
} from "../modules/ai-agents/lib/agent-executor";

describe("topologicalSort", () => {
	it("returns an empty array for an empty graph", () => {
		const graph: WorkflowGraph = { nodes: [], edges: [] };
		const result = topologicalSort(graph);
		expect(result).toEqual([]);
	});

	it("sorts a linear graph in order", () => {
		const graph: WorkflowGraph = {
			nodes: [
				{ id: "b", type: "agent", label: "B", agentId: "b-agent" },
				{ id: "a", type: "agent", label: "A", agentId: "a-agent" },
			],
			edges: [{ source: "a", target: "b" }],
		};
		const result = topologicalSort(graph);
		expect(result[0]?.id).toBe("a");
		expect(result[1]?.id).toBe("b");
	});

	it("throws on a cyclic graph", () => {
		const graph: WorkflowGraph = {
			nodes: [
				{ id: "a", type: "agent", label: "A", agentId: "a-agent" },
				{ id: "b", type: "agent", label: "B", agentId: "b-agent" },
			],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "a" },
			],
		};
		expect(() => topologicalSort(graph)).toThrow("cycle");
	});
});

describe("executeWorkflow guards", () => {
	it("rejects a graph with no agent nodes", async () => {
		const graph: WorkflowGraph = { nodes: [], edges: [] };
		const events: unknown[] = [];

		for await (const event of executeWorkflow("sess-1", graph, "hello")) {
			events.push(event);
		}

		const errorEvent = events.find(
			(e) => (e as { type: string }).type === "error",
		);
		expect(errorEvent).toBeDefined();
	});

	it("rejects a graph exceeding MAX_AGENTS_PER_WORKFLOW", async () => {
		const nodeCount = MAX_AGENTS_PER_WORKFLOW + 1;
		const nodes = Array.from({ length: nodeCount }, (_, i) => ({
			id: `node-${i}`,
			type: "agent" as const,
			label: `Agent ${i}`,
			agentId: `agent-${i}`,
		}));
		const graph: WorkflowGraph = { nodes, edges: [] };
		const events: unknown[] = [];

		for await (const event of executeWorkflow("sess-2", graph, "hello")) {
			events.push(event);
		}

		const errorEvent = events.find(
			(e) => (e as { type: string }).type === "error",
		);
		expect(errorEvent).toBeDefined();
	});
});
