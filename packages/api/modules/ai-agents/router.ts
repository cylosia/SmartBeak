/**
 * Phase 3B — AI Agents Router
 *
 * Aggregates all AI agent procedures into a single router that is
 * mounted at `aiAgents` in the main orpc router.
 */

import { getAgentAnalyticsProcedure } from "./procedures/get-analytics";
import {
  createAgentProcedure,
  deleteAgentProcedure,
  listAgents,
  seedDefaultAgents,
  updateAgentProcedure,
} from "./procedures/manage-agents";
import {
  createWorkflowProcedure,
  deleteWorkflowProcedure,
  getSession,
  getWorkflow,
  initiateWorkflowRun,
  listSessions,
  listWorkflows,
  updateWorkflowProcedure,
} from "./procedures/manage-workflows";

export const aiAgentsRouter = {
  // Agent management
  listAgents,
  createAgent: createAgentProcedure,
  updateAgent: updateAgentProcedure,
  deleteAgent: deleteAgentProcedure,
  seedDefaultAgents,

  // Workflow management
  listWorkflows,
  getWorkflow,
  createWorkflow: createWorkflowProcedure,
  updateWorkflow: updateWorkflowProcedure,
  deleteWorkflow: deleteWorkflowProcedure,

  // Session management
  initiateWorkflowRun,
  listSessions,
  getSession,

  // Analytics
  getAnalytics: getAgentAnalyticsProcedure,
};
