"use client";

/**
 * Phase 3B — No-Code Workflow Builder
 *
 * A visual drag-and-drop interface for creating and connecting AI agent workflows.
 * Renders a canvas with draggable agent nodes and connectable edges.
 * Serializes to/from the WorkflowGraph JSON format stored in ai_workflows.steps_json.
 *
 * Architecture:
 * - Uses a simple canvas-based approach with pure React (no heavy flow library dependency).
 * - Nodes are positioned absolutely on a scrollable canvas.
 * - Edges are rendered as SVG lines between node centers.
 * - The graph is serialized and saved via the updateWorkflow orpc procedure.
 */

import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "@repo/database";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangleIcon,
	BotIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	GripVerticalIcon,
	Loader2Icon,
	PlayIcon,
	PlusIcon,
	SaveIcon,
	SparklesIcon,
	Trash2Icon,
	XCircleIcon,
	ZapIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useAgentStream } from "../hooks/useAgentStream";

interface WorkflowBuilderProps {
	organizationSlug: string;
	workflowId: string;
}

const AGENT_TYPE_COLORS: Record<string, string> = {
	research:
		"bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400",
	writer: "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-400",
	editor: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400",
	custom: "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400",
};

const AGENT_TYPE_ICONS: Record<string, React.ReactNode> = {
	research: <ZapIcon className="h-4 w-4" />,
	writer: <SparklesIcon className="h-4 w-4" />,
	editor: <CheckCircle2Icon className="h-4 w-4" />,
	custom: <BotIcon className="h-4 w-4" />,
};

export function WorkflowBuilder({
	organizationSlug,
	workflowId,
}: WorkflowBuilderProps) {
	const queryClient = useQueryClient();

	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [runPrompt, setRunPrompt] = useState("");
	const [showRunPanel, setShowRunPanel] = useState(false);
	const [dragging, setDragging] = useState<{
		nodeId: string;
		offsetX: number;
		offsetY: number;
	} | null>(null);
	const [localGraph, setLocalGraph] = useState<WorkflowGraph | null>(null);
	const canvasRef = useRef<HTMLDivElement>(null);

	const {
		isStreaming,
		isComplete,
		error: streamError,
		nodeStates,
		finalOutput: _finalOutput,
		totalCostCents,
		startStream,
		reset: resetStream,
	} = useAgentStream();

	// ── Queries ─────────────────────────────────────────────────────────────────

	const workflowQuery = useQuery(
		orpc.aiAgents.getWorkflow.queryOptions({
			input: { organizationSlug, workflowId },
		}),
	);

	const serverGraph = (
		workflowQuery.data as
			| { workflow: { stepsJson: WorkflowGraph } }
			| undefined
	)?.workflow?.stepsJson as WorkflowGraph | undefined;

	const graph: WorkflowGraph = localGraph ??
		serverGraph ?? { nodes: [], edges: [] };
	const setGraph = (
		updater: WorkflowGraph | ((prev: WorkflowGraph) => WorkflowGraph),
	) => {
		setLocalGraph((prev) => {
			const current = prev ?? serverGraph ?? { nodes: [], edges: [] };
			return typeof updater === "function" ? updater(current) : updater;
		});
	};

	const agentsQuery = useQuery(
		orpc.aiAgents.listAgents.queryOptions({
			input: { organizationSlug },
		}),
	);

	// ── Mutations ────────────────────────────────────────────────────────────────

	const saveMutation = useMutation({
		...orpc.aiAgents.updateWorkflow.mutationOptions(),
		onSuccess: () => {
			toastSuccess("Workflow saved");
			queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
		},
		onError: () => toastError("Error", "Failed to save workflow"),
	});

	const runMutation = useMutation({
		...orpc.aiAgents.initiateWorkflowRun.mutationOptions(),
		onSuccess: (data) => {
			resetStream();
			startStream((data as { sessionId: string }).sessionId);
		},
		onError: () => toastError("Error", "Failed to start workflow run"),
	});

	// ── Graph Manipulation ───────────────────────────────────────────────────────

	const addAgentNode = useCallback(
		(agentId: string, agentName: string, _agentType: string) => {
			const id = `node-${Date.now()}`;
			const newNode: WorkflowNode = {
				id,
				type: "agent",
				agentId,
				label: agentName,
				config: {},
				position: {
					x: 100 + graph.nodes.length * 220,
					y: 150,
				},
			};

			// Auto-connect to the last agent node
			const lastAgentNode = [...graph.nodes]
				.reverse()
				.find((n) => n.type === "agent");

			const newEdges: WorkflowEdge[] = lastAgentNode
				? [
						...graph.edges,
						{
							id: `edge-${lastAgentNode.id}-${id}`,
							source: lastAgentNode.id,
							target: id,
						},
					]
				: graph.edges;

			setGraph((prev) => ({
				nodes: [...prev.nodes, newNode],
				edges: newEdges,
			}));
		},
		[graph.nodes, graph.edges],
	);

	const removeNode = useCallback((nodeId: string) => {
		setGraph((prev) => ({
			nodes: prev.nodes.filter((n) => n.id !== nodeId),
			edges: prev.edges.filter(
				(e) => e.source !== nodeId && e.target !== nodeId,
			),
		}));
		setSelectedNodeId(null);
	}, []);

	// ── Drag Handling ────────────────────────────────────────────────────────────

	const handleMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string) => {
			e.preventDefault();
			const canvas = canvasRef.current;
			if (!canvas) {
				return;
			}
			const rect = canvas.getBoundingClientRect();
			const node = graph.nodes.find((n) => n.id === nodeId);
			if (!node) {
				return;
			}
			setDragging({
				nodeId,
				offsetX: e.clientX - rect.left - node.position.x,
				offsetY: e.clientY - rect.top - node.position.y,
			});
			setSelectedNodeId(nodeId);
		},
		[graph.nodes],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!dragging || !canvasRef.current) {
				return;
			}
			const rect = canvasRef.current.getBoundingClientRect();
			const x = Math.max(0, e.clientX - rect.left - dragging.offsetX);
			const y = Math.max(0, e.clientY - rect.top - dragging.offsetY);
			setGraph((prev) => ({
				...prev,
				nodes: prev.nodes.map((n) =>
					n.id === dragging.nodeId ? { ...n, position: { x, y } } : n,
				),
			}));
		},
		[dragging],
	);

	const handleMouseUp = useCallback(() => {
		setDragging(null);
	}, []);

	// ── Save & Run ────────────────────────────────────────────────────────────────

	const handleSave = () => {
		saveMutation.mutate({
			organizationSlug,
			workflowId,
			stepsJson: graph,
		});
	};

	const handleRun = () => {
		if (!runPrompt.trim()) {
			toastError("Error", "Please enter a prompt to run the workflow.");
			return;
		}
		runMutation.mutate({
			organizationSlug,
			workflowId,
			prompt: runPrompt,
		});
	};

	// ── Edge SVG ──────────────────────────────────────────────────────────────────

	const renderEdges = () => {
		const NODE_W = 200;
		const NODE_H = 80;
		return (
			<svg
				className="absolute inset-0 pointer-events-none"
				style={{ width: "100%", height: "100%" }}
				aria-hidden="true"
			>
				<title>Workflow edges</title>
				<defs>
					<marker
						id="arrowhead"
						markerWidth="10"
						markerHeight="7"
						refX="10"
						refY="3.5"
						orient="auto"
					>
						<polygon
							points="0 0, 10 3.5, 0 7"
							className="fill-muted-foreground"
						/>
					</marker>
				</defs>
				{graph.edges.map((edge) => {
					const src = graph.nodes.find((n) => n.id === edge.source);
					const tgt = graph.nodes.find((n) => n.id === edge.target);
					if (!src || !tgt) {
						return null;
					}
					const x1 = src.position.x + NODE_W;
					const y1 = src.position.y + NODE_H / 2;
					const x2 = tgt.position.x;
					const y2 = tgt.position.y + NODE_H / 2;
					const cx = (x1 + x2) / 2;
					return (
						<path
							key={edge.id}
							d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
							fill="none"
							className="stroke-muted-foreground/60"
							strokeWidth={2}
							markerEnd="url(#arrowhead)"
						/>
					);
				})}
			</svg>
		);
	};

	const agents =
		(
			agentsQuery.data as {
				agents: Array<{
					id: string;
					name: string;
					agentType: string;
					isActive: boolean;
				}>;
			}
		)?.agents ?? [];
	const workflow = (workflowQuery.data as { workflow: { name: string } })
		?.workflow;

	if (workflowQuery.isError) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 py-20">
				<AlertTriangleIcon className="h-12 w-12 text-destructive opacity-60" />
				<div className="text-center">
					<p className="font-medium text-destructive">
						Failed to load workflow
					</p>
					<p className="text-sm text-muted-foreground mt-1">
						{workflowQuery.error?.message ??
							"An unexpected error occurred."}
					</p>
				</div>
				<Button
					variant="outline"
					onClick={() => workflowQuery.refetch()}
				>
					Try Again
				</Button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col gap-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold">
						{workflow?.name ?? "Workflow Builder"}
					</h2>
					<p className="text-sm text-muted-foreground">
						Drag agents onto the canvas and connect them to build a
						workflow.
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleSave}
						disabled={saveMutation.isPending}
					>
						{saveMutation.isPending ? (
							<Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<SaveIcon className="mr-2 h-4 w-4" />
						)}
						Save
					</Button>
					<Button
						size="sm"
						onClick={() => setShowRunPanel((v) => !v)}
					>
						<PlayIcon className="mr-2 h-4 w-4" />
						Run Workflow
					</Button>
				</div>
			</div>

			<div className="flex flex-1 gap-4 overflow-hidden min-h-0">
				{/* Agent Palette */}
				<div className="w-56 flex-shrink-0 space-y-3">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
						Available Agents
					</p>
					{agentsQuery.isLoading ? (
						<div className="space-y-2">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="h-16 rounded-lg bg-muted animate-pulse"
								/>
							))}
						</div>
					) : agentsQuery.isError ? (
						<div className="rounded-lg border border-destructive/40 p-3 text-center space-y-2">
							<AlertTriangleIcon className="h-5 w-5 text-destructive mx-auto" />
							<p className="text-xs text-destructive">
								Failed to load agents
							</p>
							<Button
								variant="outline"
								size="sm"
								className="w-full"
								onClick={() => agentsQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					) : agents.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No agents found. Create agents first.
						</p>
					) : (
						agents
							.filter((a) => a.isActive)
							.map((agent) => (
								<button
									key={agent.id}
									type="button"
									onClick={() =>
										addAgentNode(
											agent.id,
											agent.name,
											agent.agentType,
										)
									}
									className={`w-full rounded-lg border p-3 text-left transition-all hover:scale-[1.02] hover:shadow-sm cursor-grab active:cursor-grabbing ${
										AGENT_TYPE_COLORS[agent.agentType] ??
										AGENT_TYPE_COLORS.custom
									}`}
								>
									<div className="flex items-center gap-2">
										{AGENT_TYPE_ICONS[agent.agentType] ??
											AGENT_TYPE_ICONS.custom}
										<span className="text-sm font-medium truncate">
											{agent.name}
										</span>
									</div>
									<Badge
										status="info"
										className="mt-1 text-xs capitalize"
									>
										{agent.agentType}
									</Badge>
								</button>
							))
					)}
					<Button
						variant="outline"
						size="sm"
						className="w-full border-dashed"
						onClick={() =>
							(window.location.href = `/${organizationSlug}/ai-agents`)
						}
					>
						<PlusIcon className="mr-2 h-4 w-4" />
						New Agent
					</Button>
				</div>

				{/* Canvas */}
				<div className="flex-1 relative overflow-auto rounded-xl border border-border bg-muted/20 min-h-[300px] md:min-h-[400px]">
					{/* biome-ignore lint/a11y/noStaticElementInteractions: drag canvas requires mouse events for node positioning */}
					<div
						ref={canvasRef}
						role="presentation"
						className="relative min-w-[800px] min-h-[400px] md:min-w-[1200px] md:min-h-[600px]"
						onMouseMove={handleMouseMove}
						onMouseUp={handleMouseUp}
						onMouseLeave={handleMouseUp}
					>
						{/* Grid pattern */}
						<svg
							className="absolute inset-0 pointer-events-none opacity-30"
							style={{ width: "100%", height: "100%" }}
							aria-hidden="true"
						>
							<title>Grid background</title>
							<defs>
								<pattern
									id="grid"
									width="24"
									height="24"
									patternUnits="userSpaceOnUse"
								>
									<path
										d="M 24 0 L 0 0 0 24"
										fill="none"
										className="stroke-border"
										strokeWidth="0.5"
									/>
								</pattern>
							</defs>
							<rect
								width="100%"
								height="100%"
								fill="url(#grid)"
							/>
						</svg>

						{/* Edges */}
						{renderEdges()}

						{/* Nodes */}
						{graph.nodes.map((node) => {
							const nodeState = nodeStates.find(
								(s) => s.nodeId === node.id,
							);
							const isSelected = selectedNodeId === node.id;
							const agentType =
								agents.find((a) => a.id === node.agentId)
									?.agentType ?? "custom";

							return (
								// biome-ignore lint/a11y/useSemanticElements: draggable workflow node requires absolute positioning incompatible with native button
								<div
									key={node.id}
									role="button"
									tabIndex={0}
									className={`absolute select-none rounded-xl border-2 bg-background shadow-sm transition-shadow cursor-grab active:cursor-grabbing ${
										isSelected
											? "border-primary shadow-md"
											: "border-border hover:border-primary/50"
									}`}
									style={{
										left: node.position.x,
										top: node.position.y,
										width: 200,
									}}
									onMouseDown={(e) =>
										handleMouseDown(e, node.id)
									}
									onKeyDown={(e) => {
										if (
											e.key === "Enter" ||
											e.key === " "
										) {
											e.preventDefault();
										}
									}}
								>
									<div
										className={`flex items-center gap-2 rounded-t-xl px-3 py-2 ${
											AGENT_TYPE_COLORS[agentType] ??
											AGENT_TYPE_COLORS.custom
										}`}
									>
										<GripVerticalIcon className="h-3.5 w-3.5 opacity-50" />
										{AGENT_TYPE_ICONS[agentType]}
										<span className="text-xs font-semibold truncate flex-1">
											{node.label}
										</span>
										<button
											type="button"
											aria-label="Remove node"
											onClick={(e) => {
												e.stopPropagation();
												removeNode(node.id);
											}}
											className="opacity-50 hover:opacity-100"
										>
											<Trash2Icon className="h-3 w-3" />
										</button>
									</div>
									<div className="px-3 py-2">
										{nodeState ? (
											<div className="flex items-center gap-1.5 text-xs">
												{nodeState.status ===
													"running" && (
													<>
														<Loader2Icon className="h-3 w-3 animate-spin text-blue-500 dark:text-blue-400" />
														<span className="text-muted-foreground">
															Running...
														</span>
													</>
												)}
												{nodeState.status ===
													"complete" && (
													<>
														<CheckCircle2Icon className="h-3 w-3 text-green-500 dark:text-green-400" />
														<span className="text-green-600 dark:text-green-400">
															Done · $
															{(
																nodeState.costCents /
																100
															).toFixed(4)}
														</span>
													</>
												)}
												{nodeState.status ===
													"error" && (
													<>
														<XCircleIcon className="h-3 w-3 text-destructive" />
														<span className="text-destructive">
															Failed
														</span>
													</>
												)}
											</div>
										) : (
											<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
												<CircleDotIcon className="h-3 w-3" />
												<span>Ready</span>
											</div>
										)}
									</div>
								</div>
							);
						})}

						{graph.nodes.length === 0 && (
							<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
								<BotIcon className="h-12 w-12 opacity-20" />
								<p className="text-sm">
									Click an agent from the palette to add it to
									the canvas.
								</p>
							</div>
						)}
					</div>
				</div>

				{/* Run Panel */}
				{showRunPanel && (
					<div className="w-80 flex-shrink-0 space-y-4">
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<PlayIcon className="h-4 w-4" />
									Run Workflow
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="space-y-1.5">
									<Label
										htmlFor="run-prompt"
										className="text-xs"
									>
										Prompt
									</Label>
									<Textarea
										id="run-prompt"
										placeholder="What should the agents work on?"
										value={runPrompt}
										onChange={(e) =>
											setRunPrompt(e.target.value)
										}
										rows={4}
										className="text-sm resize-none"
									/>
								</div>
								<Button
									className="w-full"
									size="sm"
									onClick={handleRun}
									disabled={
										isStreaming ||
										runMutation.isPending ||
										graph.nodes.length === 0
									}
								>
									{isStreaming || runMutation.isPending ? (
										<Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<PlayIcon className="mr-2 h-4 w-4" />
									)}
									{isStreaming ? "Running..." : "Run"}
								</Button>
							</CardContent>
						</Card>

						{/* Live Output */}
						{(isStreaming || isComplete || streamError) && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm">
										Live Output
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									{nodeStates.map((ns) => (
										<div
											key={ns.nodeId}
											className="space-y-1"
										>
											<div className="flex items-center gap-1.5 text-xs font-medium">
												{ns.status === "running" && (
													<Loader2Icon className="h-3 w-3 animate-spin text-blue-500 dark:text-blue-400" />
												)}
												{ns.status === "complete" && (
													<CheckCircle2Icon className="h-3 w-3 text-green-500 dark:text-green-400" />
												)}
												{ns.status === "error" && (
													<XCircleIcon className="h-3 w-3 text-destructive" />
												)}
												<span>{ns.agentName}</span>
											</div>
											{ns.output && (
												<p className="text-xs text-muted-foreground line-clamp-3 bg-muted/50 rounded p-2">
													{ns.output}
												</p>
											)}
										</div>
									))}

									{isComplete && (
										<div className="pt-2 border-t">
											<p className="text-xs text-muted-foreground">
												Total cost:{" "}
												<span className="font-medium text-foreground">
													$
													{(
														totalCostCents / 100
													).toFixed(4)}
												</span>
											</p>
										</div>
									)}

									{streamError && (
										<p className="text-xs text-destructive">
											{streamError}
										</p>
									)}
								</CardContent>
							</Card>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
