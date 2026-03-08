/**
 * Phase 3B — useAgentStream Hook
 *
 * Consumes the Server-Sent Events stream from POST /api/ai/stream/workflow.
 * Provides real-time updates on workflow execution progress, per-agent
 * outputs, and final cost/token metrics.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentStreamEvent {
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

export interface AgentNodeState {
	nodeId: string;
	agentName: string;
	status: "pending" | "running" | "complete" | "error";
	output: string;
	costCents: number;
	inputTokens: number;
	outputTokens: number;
}

export interface UseAgentStreamReturn {
	isStreaming: boolean;
	isComplete: boolean;
	error: string | null;
	nodeStates: AgentNodeState[];
	finalOutput: string;
	totalCostCents: number;
	startStream: (sessionId: string) => void;
	reset: () => void;
}

export function useAgentStream(): UseAgentStreamReturn {
	const [isStreaming, setIsStreaming] = useState(false);
	const [isComplete, setIsComplete] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nodeStates, setNodeStates] = useState<AgentNodeState[]>([]);
	const [finalOutput, setFinalOutput] = useState("");
	const [totalCostCents, setTotalCostCents] = useState(0);

	const abortRef = useRef<AbortController | null>(null);
	const runIdRef = useRef(0);

	const reset = useCallback(() => {
		runIdRef.current += 1;
		abortRef.current?.abort();
		abortRef.current = null;
		setIsStreaming(false);
		setIsComplete(false);
		setError(null);
		setNodeStates([]);
		setFinalOutput("");
		setTotalCostCents(0);
	}, []);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			abortRef.current = null;
			runIdRef.current += 1;
		};
	}, []);

	const startStream = useCallback(
		(sessionId: string) => {
			reset();
			setIsStreaming(true);

			const runId = runIdRef.current;
			const controller = new AbortController();
			abortRef.current = controller;
			const isCurrentRun = () =>
				runIdRef.current === runId && abortRef.current === controller;

			(async () => {
				try {
					const response = await fetch("/api/ai/stream/workflow", {
						method: "POST",
						signal: controller.signal,
						headers: {
							Accept: "text/event-stream",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ sessionId }),
					});

					if (!response.ok) {
						throw new Error(
							`Stream failed: HTTP ${response.status}`,
						);
					}

					const reader = response.body?.getReader();
					if (!reader) {
						throw new Error("No response body");
					}

					const decoder = new TextDecoder();
					let buffer = "";

					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";

						for (const line of lines) {
							if (!line.startsWith("data: ")) {
								continue;
							}
							const jsonStr = line.slice(6).trim();
							if (!jsonStr) {
								continue;
							}

							let event: AgentStreamEvent;
							try {
								event = JSON.parse(jsonStr) as AgentStreamEvent;
							} catch {
								continue;
							}

							if (!isCurrentRun()) {
								return;
							}
							handleEvent(event);
						}
					}
				} catch (err) {
					if (
						isCurrentRun() &&
						(err as Error).name !== "AbortError"
					) {
						setError(
							err instanceof Error ? err.message : "Stream error",
						);
						setNodeStates((prev) =>
							prev.map((node) =>
								node.status === "running"
									? { ...node, status: "error" }
									: node,
							),
						);
					}
				} finally {
					if (isCurrentRun()) {
						abortRef.current = null;
						setIsStreaming(false);
					}
				}
			})();

			function handleEvent(event: AgentStreamEvent) {
				if (!isCurrentRun()) {
					return;
				}

				switch (event.type) {
					case "node_start":
						setNodeStates((prev) => [
							...prev,
							{
								nodeId: event.nodeId ?? "",
								agentName: event.agentName ?? "Agent",
								status: "running",
								output: "",
								costCents: 0,
								inputTokens: 0,
								outputTokens: 0,
							},
						]);
						break;

					case "node_stream":
						setNodeStates((prev) =>
							prev.map((n) =>
								n.nodeId === event.nodeId
									? {
											...n,
											output:
												n.output + (event.chunk ?? ""),
										}
									: n,
							),
						);
						break;

					case "node_complete":
						setNodeStates((prev) =>
							prev.map((n) =>
								n.nodeId === event.nodeId
									? {
											...n,
											status: "complete",
											output: event.output ?? n.output,
											costCents: event.costCents ?? 0,
											inputTokens: event.inputTokens ?? 0,
											outputTokens:
												event.outputTokens ?? 0,
										}
									: n,
							),
						);
						break;

					case "session_complete":
						setFinalOutput(event.output ?? "");
						setTotalCostCents(event.totalCostCents ?? 0);
						setIsComplete(true);
						setIsStreaming(false);
						break;

					case "error":
						setError(event.error ?? "Unknown error");
						setNodeStates((prev) =>
							prev.map((n) =>
								n.status === "running"
									? { ...n, status: "error" }
									: n,
							),
						);
						setIsStreaming(false);
						break;
				}
			}
		},
		[reset],
	);

	return {
		isStreaming,
		isComplete,
		error,
		nodeStates,
		finalOutput,
		totalCostCents,
		startStream,
		reset,
	};
}
