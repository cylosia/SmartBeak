/**
 * Shared return-type interfaces for AI Agent procedures.
 *
 * Frontend components should import these instead of using `as unknown as`.
 */

export interface AiAgentItem {
	id: string;
	name: string;
	description: string | null;
	agentType: string;
	isActive: boolean;
	config: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
	};
	createdAt: Date | string;
}

export interface AiWorkflowItem {
	id: string;
	name: string;
	description: string | null;
	status: string;
	createdAt: Date | string;
	stepsJson: { nodes: unknown[] };
}

export interface AiSessionItem {
	id: string;
	status: string;
	costCents: number | null;
	durationMs: number | null;
	totalInputTokens: number | null;
	totalOutputTokens: number | null;
	createdAt: Date | string;
	completedAt: Date | string | null;
	errorMessage: string | null;
	workflow: { name: string } | null;
}

export interface ListAgentsResponse {
	agents: AiAgentItem[];
}

export interface ListWorkflowsResponse {
	workflows: AiWorkflowItem[];
}

export interface ListSessionsResponse {
	sessions: AiSessionItem[];
}
