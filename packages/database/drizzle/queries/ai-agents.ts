/**
 * SmartBeak Phase 3B — AI Agents DB query functions.
 *
 * All queries use the additive ai-agents schema.
 * The locked v9 smartbeak.ts schema is not modified.
 */

import {
	and,
	avg,
	count,
	desc,
	eq,
	gte,
	inArray,
	lte,
	sql,
	sum,
} from "drizzle-orm";
import { db } from "../client";
import { aiAgentSessions, aiAgents, aiWorkflows } from "../schema/ai-agents";
import type {
	AiAgentConfig,
	AiMemoryContext,
	WorkflowGraph,
} from "../zod-ai-agents";

// ─── Agents ───────────────────────────────────────────────────────────────────

export async function getAgentsForOrg(orgId: string) {
	return db.query.aiAgents.findMany({
		where: (a, { eq }) => eq(a.orgId, orgId),
		orderBy: (a, { asc }) => [asc(a.name)],
		limit: 100,
	});
}

export async function getActiveAgentsForOrg(orgId: string) {
	return db.query.aiAgents.findMany({
		where: (a, { and, eq }) =>
			and(eq(a.orgId, orgId), eq(a.isActive, true)),
		orderBy: (a, { asc }) => [asc(a.name)],
		limit: 100,
	});
}

export async function getAgentById(agentId: string) {
	return db.query.aiAgents.findFirst({
		where: (a, { eq }) => eq(a.id, agentId),
	});
}

export async function getAgentsByIds(agentIds: string[]) {
	if (agentIds.length === 0) {
		return [];
	}
	return db.query.aiAgents.findMany({
		where: (a) => inArray(a.id, agentIds),
		limit: agentIds.length,
	});
}

export async function createAgent(data: {
	orgId: string;
	name: string;
	description?: string;
	agentType: "research" | "writer" | "editor" | "custom";
	config: AiAgentConfig;
	createdBy: string;
}) {
	const rows = await db
		.insert(aiAgents)
		.values({
			orgId: data.orgId,
			name: data.name,
			description: data.description ?? null,
			agentType: data.agentType,
			config: data.config,
			memoryContext: {
				summary: "",
				facts: [],
				lastUpdatedAt: new Date().toISOString(),
			},
			createdBy: data.createdBy,
		})
		.returning();
	// biome-ignore lint/style/noNonNullAssertion: INSERT...RETURNING always returns the row
	return rows[0]!;
}

export async function updateAgent(
	agentId: string,
	data: {
		name?: string;
		description?: string | null;
		config?: Partial<AiAgentConfig>;
		isActive?: boolean;
		updatedAt?: Date;
	},
) {
	const rows = await db
		.update(aiAgents)
		.set({
			...(data.name !== undefined && { name: data.name }),
			...(data.description !== undefined && {
				description: data.description,
			}),
			...(data.config !== undefined && { config: data.config }),
			...(data.isActive !== undefined && { isActive: data.isActive }),
			updatedAt: data.updatedAt ?? new Date(),
		})
		.where(eq(aiAgents.id, agentId))
		.returning();
	return rows[0] ?? null;
}

export async function updateAgentMemory(
	agentId: string,
	memoryContext: AiMemoryContext,
) {
	const rows = await db
		.update(aiAgents)
		.set({
			memoryContext,
			updatedAt: new Date(),
		})
		.where(eq(aiAgents.id, agentId))
		.returning();
	return rows[0] ?? null;
}

export async function deleteAgent(agentId: string) {
	await db.delete(aiAgents).where(eq(aiAgents.id, agentId));
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export async function getWorkflowsForOrg(orgId: string) {
	return db.query.aiWorkflows.findMany({
		where: (w, { eq }) => eq(w.orgId, orgId),
		orderBy: (w, { desc }) => [desc(w.updatedAt)],
		limit: 100,
	});
}

export async function getWorkflowById(workflowId: string) {
	return db.query.aiWorkflows.findFirst({
		where: (w, { eq }) => eq(w.id, workflowId),
	});
}

export async function createWorkflow(data: {
	orgId: string;
	name: string;
	description?: string;
	stepsJson?: WorkflowGraph;
	createdBy: string;
}) {
	const rows = await db
		.insert(aiWorkflows)
		.values({
			orgId: data.orgId,
			name: data.name,
			description: data.description ?? null,
			stepsJson: data.stepsJson ?? { nodes: [], edges: [] },
			createdBy: data.createdBy,
		})
		.returning();
	// biome-ignore lint/style/noNonNullAssertion: INSERT...RETURNING always returns the row
	return rows[0]!;
}

export async function updateWorkflow(
	workflowId: string,
	data: {
		name?: string;
		description?: string | null;
		stepsJson?: WorkflowGraph;
		status?: "draft" | "active" | "archived";
		estimatedCostCents?: number;
	},
) {
	const rows = await db
		.update(aiWorkflows)
		.set({
			...(data.name !== undefined && { name: data.name }),
			...(data.description !== undefined && {
				description: data.description,
			}),
			...(data.stepsJson !== undefined && { stepsJson: data.stepsJson }),
			...(data.status !== undefined && { status: data.status }),
			...(data.estimatedCostCents !== undefined && {
				estimatedCostCents: data.estimatedCostCents,
			}),
			updatedAt: new Date(),
		})
		.where(eq(aiWorkflows.id, workflowId))
		.returning();
	return rows[0] ?? null;
}

export async function deleteWorkflow(workflowId: string) {
	await db.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(data: {
	orgId: string;
	workflowId?: string;
	triggeredBy: string;
	inputData: Record<string, unknown>;
	memoryState: Record<string, unknown>;
}) {
	const rows = await db
		.insert(aiAgentSessions)
		.values({
			orgId: data.orgId,
			workflowId: data.workflowId ?? null,
			triggeredBy: data.triggeredBy,
			inputData: data.inputData,
			memoryState: data.memoryState,
			status: "pending",
			startedAt: new Date(),
		})
		.returning();
	// biome-ignore lint/style/noNonNullAssertion: INSERT...RETURNING always returns the row
	return rows[0]!;
}

export async function updateSession(
	sessionId: string,
	data: {
		status?: "pending" | "running" | "completed" | "failed" | "cancelled";
		outputData?: Record<string, unknown>;
		tokenUsage?: unknown[];
		costCents?: number;
		totalInputTokens?: number;
		totalOutputTokens?: number;
		durationMs?: number;
		errorMessage?: string | null;
		completedAt?: Date;
	},
) {
	const rows = await db
		.update(aiAgentSessions)
		.set({
			...(data.status !== undefined && { status: data.status }),
			...(data.outputData !== undefined && {
				outputData: data.outputData,
			}),
			...(data.tokenUsage !== undefined && {
				tokenUsage: data.tokenUsage,
			}),
			...(data.costCents !== undefined && { costCents: data.costCents }),
			...(data.totalInputTokens !== undefined && {
				totalInputTokens: data.totalInputTokens,
			}),
			...(data.totalOutputTokens !== undefined && {
				totalOutputTokens: data.totalOutputTokens,
			}),
			...(data.durationMs !== undefined && {
				durationMs: data.durationMs,
			}),
			...(data.errorMessage !== undefined && {
				errorMessage: data.errorMessage,
			}),
			...(data.completedAt !== undefined && {
				completedAt: data.completedAt,
			}),
		})
		.where(eq(aiAgentSessions.id, sessionId))
		.returning();
	return rows[0] ?? null;
}

export async function claimSession(sessionId: string): Promise<boolean> {
	const rows = await db
		.update(aiAgentSessions)
		.set({ status: "running" })
		.where(
			and(
				eq(aiAgentSessions.id, sessionId),
				eq(aiAgentSessions.status, "pending"),
			),
		)
		.returning({ id: aiAgentSessions.id });
	return rows.length > 0;
}

export async function getSessionsForOrg(
	orgId: string,
	opts: { limit?: number; offset?: number; workflowId?: string } = {},
) {
	const conditions = [eq(aiAgentSessions.orgId, orgId)];
	if (opts.workflowId) {
		conditions.push(eq(aiAgentSessions.workflowId, opts.workflowId));
	}

	return db.query.aiAgentSessions.findMany({
		where: and(...conditions),
		orderBy: [desc(aiAgentSessions.createdAt)],
		limit: opts.limit ?? 50,
		offset: opts.offset ?? 0,
		with: { workflow: true },
	});
}

export async function getSessionById(sessionId: string) {
	return db.query.aiAgentSessions.findFirst({
		where: (s, { eq }) => eq(s.id, sessionId),
		with: { workflow: true },
	});
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getAgentAnalytics(
	orgId: string,
	opts: { startDate?: Date; endDate?: Date } = {},
) {
	const conditions = [eq(aiAgentSessions.orgId, orgId)];
	if (opts.startDate) {
		conditions.push(gte(aiAgentSessions.createdAt, opts.startDate));
	}
	if (opts.endDate) {
		conditions.push(lte(aiAgentSessions.createdAt, opts.endDate));
	}

	const [totals] = await db
		.select({
			totalSessions: count(),
			totalCostCents: sum(aiAgentSessions.costCents),
			totalInputTokens: sum(aiAgentSessions.totalInputTokens),
			totalOutputTokens: sum(aiAgentSessions.totalOutputTokens),
			avgDurationMs: avg(aiAgentSessions.durationMs),
			completedCount: sql<number>`COUNT(*) FILTER (WHERE ${aiAgentSessions.status} = 'completed')`,
			failedCount: sql<number>`COUNT(*) FILTER (WHERE ${aiAgentSessions.status} = 'failed')`,
		})
		.from(aiAgentSessions)
		.where(and(...conditions));

	// Per-workflow breakdown
	const workflowBreakdown = await db
		.select({
			workflowId: aiAgentSessions.workflowId,
			workflowName: aiWorkflows.name,
			sessionCount: count(),
			totalCostCents: sum(aiAgentSessions.costCents),
			avgDurationMs: avg(aiAgentSessions.durationMs),
		})
		.from(aiAgentSessions)
		.leftJoin(aiWorkflows, eq(aiAgentSessions.workflowId, aiWorkflows.id))
		.where(and(...conditions))
		.groupBy(aiAgentSessions.workflowId, aiWorkflows.name)
		.orderBy(desc(count()))
		.limit(10);

	// Daily cost trend (last 30 days)
	const dailyTrend = await db
		.select({
			date: sql<string>`DATE(${aiAgentSessions.createdAt})`,
			sessionCount: count(),
			costCents: sum(aiAgentSessions.costCents),
		})
		.from(aiAgentSessions)
		.where(and(...conditions))
		.groupBy(sql`DATE(${aiAgentSessions.createdAt})`)
		.orderBy(sql`DATE(${aiAgentSessions.createdAt})`)
		.limit(90);

	return {
		totals: totals ?? {
			totalSessions: 0,
			totalCostCents: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			avgDurationMs: 0,
			completedCount: 0,
			failedCount: 0,
		},
		workflowBreakdown,
		dailyTrend,
	};
}
