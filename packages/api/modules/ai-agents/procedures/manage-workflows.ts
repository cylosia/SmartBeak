/**
 * Phase 3B — AI Workflow Management Procedures
 *
 * orpc procedures for CRUD operations on ai_workflows and ai_agent_sessions.
 * Includes workflow execution (non-streaming path via orpc) and session listing.
 */

import { ORPCError } from "@orpc/server";
import {
	CreateWorkflowInputSchema,
	createSession,
	createWorkflow,
	deleteWorkflow,
	getActiveAgentsForOrg,
	getAgentsByIds,
	getSessionById,
	getSessionsForOrg,
	getWorkflowById,
	getWorkflowsForOrg,
	RunWorkflowInputSchema,
	UpdateWorkflowInputSchema,
	updateWorkflow,
	WorkflowGraphSchema,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../orpc/procedures";
import {
	requireOrgEditor,
	requireOrgMembership,
} from "../../smartbeak/lib/membership";
import { resolveSmartBeakOrg } from "../../smartbeak/lib/resolve-org";

// ─── List Workflows ───────────────────────────────────────────────────────────

export const listWorkflows = protectedProcedure
	.route({
		method: "GET",
		path: "/ai-agents/workflows",
		tags: ["AI Agents"],
		summary: "List all workflows for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const workflows = await getWorkflowsForOrg(org.id);
		return { workflows };
	});

// ─── Get Workflow ─────────────────────────────────────────────────────────────

export const getWorkflow = protectedProcedure
	.route({
		method: "GET",
		path: "/ai-agents/workflows/{workflowId}",
		tags: ["AI Agents"],
		summary: "Get a workflow by ID",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			workflowId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const workflow = await getWorkflowById(input.workflowId);
		if (!workflow || workflow.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Workflow not found.",
			});
		}

		const graph = WorkflowGraphSchema.parse(workflow.stepsJson);
		const agentIds = graph.nodes
			.filter((n) => n.type === "agent" && n.agentId)
			.map((n) => n.agentId as string);
		const agents =
			agentIds.length > 0 ? await getAgentsByIds(agentIds) : [];
		const agentMap = new Map(agents.map((a) => [a.id, a]));
		const enrichedNodes = graph.nodes.map((node) => {
			if (node.type === "agent" && node.agentId) {
				const agent = agentMap.get(node.agentId);
				return {
					...node,
					agentName: agent?.name,
					agentType: agent?.agentType,
				};
			}
			return node;
		});

		return {
			workflow: {
				...workflow,
				stepsJson: { ...graph, nodes: enrichedNodes },
			},
		};
	});

// ─── Create Workflow ──────────────────────────────────────────────────────────

export const createWorkflowProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/ai-agents/workflows",
		tags: ["AI Agents"],
		summary: "Create a new AI workflow",
	})
	.input(CreateWorkflowInputSchema)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const workflow = await createWorkflow({
			orgId: org.id,
			name: input.name,
			description: input.description,
			stepsJson: input.stepsJson,
			createdBy: user.id,
		});

		return { workflow };
	});

// ─── Update Workflow ──────────────────────────────────────────────────────────

export const updateWorkflowProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/ai-agents/workflows/{workflowId}",
		tags: ["AI Agents"],
		summary: "Update a workflow (name, description, graph, or status)",
	})
	.input(UpdateWorkflowInputSchema)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const existing = await getWorkflowById(input.workflowId);
		if (!existing || existing.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Workflow not found.",
			});
		}

		const updated = await updateWorkflow(input.workflowId, {
			name: input.name,
			description: input.description,
			stepsJson: input.stepsJson,
			status: input.status,
		});

		return { workflow: updated };
	});

// ─── Delete Workflow ──────────────────────────────────────────────────────────

export const deleteWorkflowProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/ai-agents/workflows/{workflowId}",
		tags: ["AI Agents"],
		summary: "Delete a workflow",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			workflowId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const existing = await getWorkflowById(input.workflowId);
		if (!existing || existing.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Workflow not found.",
			});
		}

		await deleteWorkflow(input.workflowId);
		return { success: true };
	});

// ─── Create Session (initiate run) ────────────────────────────────────────────

/**
 * Creates a session record and returns the session ID.
 * The actual streaming execution is handled by the /api/ai/stream/workflow route.
 */
export const initiateWorkflowRun = protectedProcedure
	.route({
		method: "POST",
		path: "/ai-agents/workflows/{workflowId}/run",
		tags: ["AI Agents"],
		summary:
			"Initiate a workflow run and return a session ID for streaming",
	})
	.input(RunWorkflowInputSchema)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const workflow = await getWorkflowById(input.workflowId);
		if (!workflow || workflow.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Workflow not found.",
			});
		}

		if (workflow.status === "archived") {
			throw new ORPCError("BAD_REQUEST", {
				message: "Cannot run an archived workflow.",
			});
		}

		// Snapshot current agent memory states
		const agents = await getActiveAgentsForOrg(org.id);
		const memorySnapshot: Record<string, unknown> = {};
		for (const agent of agents) {
			if (agent.memoryContext) {
				memorySnapshot[agent.id] = agent.memoryContext;
			}
		}

		const session = await createSession({
			orgId: org.id,
			workflowId: input.workflowId,
			triggeredBy: user.id,
			inputData: { prompt: input.prompt, context: input.context },
			memoryState: memorySnapshot,
		});

		return {
			sessionId: session.id,
			streamUrl: `/api/ai/stream/workflow?sessionId=${session.id}`,
		};
	});

// ─── List Sessions ────────────────────────────────────────────────────────────

export const listSessions = protectedProcedure
	.route({
		method: "GET",
		path: "/ai-agents/sessions",
		tags: ["AI Agents"],
		summary: "List agent sessions for an organization",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			workflowId: z.string().uuid().optional(),
			limit: z.number().int().min(1).max(100).default(20),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const sessions = await getSessionsForOrg(org.id, {
			limit: input.limit,
			offset: input.offset,
			workflowId: input.workflowId,
		});

		return { sessions };
	});

// ─── Get Session ──────────────────────────────────────────────────────────────

export const getSession = protectedProcedure
	.route({
		method: "GET",
		path: "/ai-agents/sessions/{sessionId}",
		tags: ["AI Agents"],
		summary: "Get a session by ID with full output",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			sessionId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const session = await getSessionById(input.sessionId);
		if (!session || session.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Session not found." });
		}

		return { session };
	});
