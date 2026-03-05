/**
 * Phase 3B — AI Agents Module Public API
 *
 * Re-exports all public components, hooks, and utilities from the
 * ai-agents module for use throughout the app.
 */

// Components
export { AgentManagementDashboard } from "./components/AgentManagementDashboard";
export { AgentAnalyticsDashboard } from "./components/AgentAnalyticsDashboard";
export { WorkflowBuilder } from "./components/WorkflowBuilder";
export { AiCopilotExtension, setCopilotSuggestion } from "./components/AiCopilotExtension";
export type { CopilotAction, AiCopilotOptions } from "./components/AiCopilotExtension";
export { AiCopilotToolbar } from "./components/AiCopilotToolbar";
export { TiptapEditorWithCopilot } from "./components/TiptapEditorWithCopilot";

// Hooks
export { useAgentStream } from "./hooks/useAgentStream";
export type {
  AgentStreamEvent,
  AgentNodeState,
  UseAgentStreamReturn,
} from "./hooks/useAgentStream";
