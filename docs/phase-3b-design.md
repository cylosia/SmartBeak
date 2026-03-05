## Phase 3B: Advanced AI Agents — Architecture & File Plan

### 1. Overview

Phase 3B introduces a powerful multi-agent AI system into SmartBeak. This includes a no-code workflow builder, persistent agent memory, an in-editor AI co-pilot, and detailed analytics. The architecture is designed to be modular, scalable, and deeply integrated with the existing platform.

### 2. Database Schema (`packages/database`)

New tables will be added as an additive extension to the locked v9 schema in a new `ai-agents.ts` file.

-   **`ai_agents`**: Stores agent configurations (type, model, system prompt, tools).
-   **`ai_workflows`**: Stores user-created workflows, including the visual graph representation (steps_json).
-   **`ai_agent_sessions`**: Logs each agent execution, tracking the workflow, memory state, and cost.

### 3. Backend (`packages/api`)

A new `ai-agents` module will be created to house all backend logic.

-   **Agent Execution Engine**: A core service that interprets workflow graphs, manages agent state, and orchestrates the execution of agent steps (e.g., calling the Research Agent, then the Writer Agent).
-   **Streaming API Routes**: New Next.js API routes (`/api/ai/stream/workflow` and `/api/ai/stream/copilot`) will handle real-time communication with the frontend using the Vercel AI SDK.
-   **orpc Routers**: New tRPC procedures for managing agents, workflows, and sessions, and for fetching analytics data.

### 4. Frontend (`apps/web`)

New components and pages will be created within a new `ai-agents` module.

-   **Workflow Builder**: A drag-and-drop interface for creating and connecting agent workflows. Will use a library like `react-flow`.
-   **Agent Dashboard**: A central hub for managing agents, workflows, and viewing recent sessions.
-   **Agent Analytics**: A dashboard displaying agent usage, performance metrics, and cost breakdowns.
-   **Tiptap Co-Pilot Extension**: A custom Tiptap extension that provides the inline AI co-pilot functionality (suggest, rewrite, etc.).

### 5. File Plan

```
/home/ubuntu/SmartBeak/
├── docs/
│   └── phase-3b-design.md
├── packages/
│   ├── api/
│   │   ├── modules/
│   │   │   └── ai-agents/
│   │   │       ├── lib/              # Core logic
│   │   │       │   ├── agent-executor.ts
│   │   │       │   ├── agent-memory.ts
│   │   │       │   └── agent-tools.ts
│   │   │       ├── procedures/       # orpc procedures
│   │   │       │   ├── manage-agents.ts
│   │   │       │   ├── manage-workflows.ts
│   │   │       │   └── get-analytics.ts
│   │   │       └── router.ts         # Main AI agents router
│   │   └── orpc/
│   │       └── router.ts         # (Modified)
│   └── database/
│       ├── drizzle/
│       │   ├── schema/
│       │   │   ├── ai-agents.ts    # (New)
│       │   │   └── index.ts        # (Modified)
│       │   ├── queries/
│       │   │   ├── ai-agents.ts    # (New)
│       │   │   └── index.ts        # (Modified)
│       │   ├── zod-ai-agents.ts  # (New)
│       │   └── index.ts          # (Modified)
│       └── index.ts              # (Modified)
└── apps/
    └── web/
        ├── app/
        │   ├── (saas)/app/(organizations)/[organizationSlug]/
        │   │   └── ai-agents/          # New route group
        │   │       ├── layout.tsx
        │   │       ├── page.tsx        # Redirect to builder
        │   │       ├── builder/
        │   │       │   └── page.tsx
        │   │       ├── analytics/
        │   │       │   └── page.tsx
        │   │       └── sessions/
        │   │           └── page.tsx
        │   └── api/ai/stream/
        │       ├── workflow/route.ts # (New)
        │       └── copilot/route.ts  # (New)
        └── modules/
            ├── smartbeak/
            │   ├── ai-agents/
            │   │   ├── components/     # React components
            │   │   │   ├── WorkflowBuilder.tsx
            │   │   │   ├── AgentAnalyticsDashboard.tsx
            │   │   │   └── AgentSessionList.tsx
            │   │   └── hooks/          # React hooks
            │   │       └── useAgentStream.ts
            │   └── content/
            │       └── components/
            │           ├── TiptapEditor.tsx # (Modified)
            │           └── TiptapAiCopilot.ts # (New)
            └── shared/
                └── lib/
                    └── orpc-query-utils.ts # (Modified)
```
