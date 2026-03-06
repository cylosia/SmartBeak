/**
 * Phase 3B — AI Agents Module Public API
 *
 * Re-exports all public components, hooks, and utilities from the
 * ai-agents module for use throughout the app.
 */

export { AgentAnalyticsDashboard } from "./components/AgentAnalyticsDashboard";
// Components
export { AgentManagementDashboard } from "./components/AgentManagementDashboard";
export type {
	AiCopilotOptions,
	CopilotAction,
} from "./components/AiCopilotExtension";
export {
	AiCopilotExtension,
	setCopilotSuggestion,
} from "./components/AiCopilotExtension";
export { AiCopilotToolbar } from "./components/AiCopilotToolbar";
export { TiptapEditorWithCopilot } from "./components/TiptapEditorWithCopilot";
export { WorkflowBuilder } from "./components/WorkflowBuilder";
export type {
	AgentNodeState,
	AgentStreamEvent,
	UseAgentStreamReturn,
} from "./hooks/useAgentStream";
// Hooks
export { useAgentStream } from "./hooks/useAgentStream";
