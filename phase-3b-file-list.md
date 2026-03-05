## Phase 3B: New and Modified Files

### Database (`packages/database`)
- `drizzle/schema/ai-agents.ts`: New schema for AI agents, workflows, and sessions.
- `drizzle/zod-ai-agents.ts`: New Zod validation schemas for the AI agents module.
- `drizzle/queries/ai-agents.ts`: New database query functions for the AI agents module.
- `drizzle/schema/index.ts`: Modified to include the new `ai-agents` schema.
- `drizzle/queries/index.ts`: Modified to include the new `ai-agents` queries.
- `drizzle/index.ts`: Modified to include the new `zod-ai-agents` exports.
- `index.ts`: Modified to export all new `ai-agents` queries, schemas, and Zod types.

### API (`packages/api`)
- `modules/ai-agents/lib/agent-tools.ts`: New library for defining agent capabilities (e.g., web search).
- `modules/ai-agents/lib/agent-memory.ts`: New library for managing persistent agent memory.
- `modules/ai-agents/lib/agent-executor.ts`: New core engine for orchestrating multi-agent workflow execution.
- `modules/ai-agents/procedures/manage-agents.ts`: New orpc procedures for agent CRUD.
- `modules/ai-agents/procedures/manage-workflows.ts`: New orpc procedures for workflow CRUD and session management.
- `modules/ai-agents/procedures/get-analytics.ts`: New orpc procedures for fetching agent analytics.
- `modules/ai-agents/router.ts`: New router for the AI agents module.
- `orpc/router.ts`: Modified to mount the new `aiAgents` router.

### Web App (`apps/web`)
- `app/api/ai/stream/workflow/route.ts`: New streaming API route for workflow execution.
- `app/api/ai/stream/copilot/route.ts`: New streaming API route for the AI Co-Pilot.
- `modules/smartbeak/ai-agents/hooks/useAgentStream.ts`: New hook for consuming the workflow execution stream.
- `modules/smartbeak/ai-agents/components/WorkflowBuilder.tsx`: New no-code workflow builder component.
- `modules/smartbeak/ai-agents/components/AgentAnalyticsDashboard.tsx`: New agent analytics dashboard component.
- `modules/smartbeak/ai-agents/components/AgentManagementDashboard.tsx`: New agent management dashboard component.
- `modules/smartbeak/ai-agents/components/AiCopilotExtension.ts`: New Tiptap extension for the AI Co-Pilot.
- `modules/smartbeak/ai-agents/components/AiCopilotToolbar.tsx`: New floating toolbar for the AI Co-Pilot.
- `modules/smartbeak/ai-agents/components/TiptapEditorWithCopilot.tsx`: New wrapper for the Tiptap editor with co-pilot integration.
- `modules/smartbeak/ai-agents/index.ts`: New index file for the AI agents module.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/layout.tsx`: New layout for the AI agents section.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/page.tsx`: New agent management page.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/workflows/page.tsx`: New workflows list page.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/workflows/[workflowId]/page.tsx`: New individual workflow builder page.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/sessions/page.tsx`: New sessions history page.
- `app/(saas)/app/(organizations)/[organizationSlug]/ai-agents/analytics/page.tsx`: New analytics page.

### Documentation (`docs`)
- `docs/phase-3b-design.md`: New design document for Phase 3B.
- `README.phase-3b.md`: New README section for Phase 3B.
