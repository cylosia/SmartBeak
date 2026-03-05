# Phase 3B: Advanced AI Agents

This phase introduces a powerful multi-agent system, a no-code workflow builder, persistent memory, and an AI co-pilot directly inside the content editor. It transforms SmartBeak from a content management system into an autonomous content creation platform.

## Features

| Feature | Description |
|---|---|
| **Multi-Agent System** | A collaborative team of AI agents (Research, Writer, Editor) that work together to produce high-quality content. |
| **No-Code Workflow Builder** | A visual drag-and-drop interface to chain agents together, creating custom content pipelines without writing any code. |
| **Long-Context Memory** | Agents now have persistent memory that allows them to learn from past interactions and maintain context across sessions and projects. |
| **AI Co-Pilot** | An intelligent writing assistant embedded directly in the Tiptap editor, offering inline suggestions, rewrites, fact-checking, and SEO optimization. |
| **Agent Analytics** | A comprehensive dashboard to track agent usage, performance, and cost, providing insights into your AI-driven content operations. |

## Technical Implementation

- **Backend**: The agent execution engine is built using the Vercel AI SDK, with support for both OpenAI and Anthropic models. A streaming API route (`/api/ai/stream/workflow`) provides real-time updates on workflow progress using Server-Sent Events (SSE).
- **Frontend**: The no-code workflow builder is a custom React component that uses a canvas-based approach for a lightweight and intuitive user experience. The AI Co-Pilot is a Tiptap extension that provides inline "ghost text" suggestions and a floating toolbar for selection-based actions.
- **Database**: The v9 schema has been extended with three new tables: `ai_agents`, `ai_workflows`, and `agent_sessions`. All database interactions are handled through Drizzle ORM with Zod validation.

## How to Use

1.  **Create Agents**: Navigate to the **AI Agents** section and create your own custom agents or use the pre-built Research, Writer, and Editor agents.
2.  **Build a Workflow**: Go to the **Workflows** tab and use the no-code builder to drag and drop agents onto the canvas and connect them in the desired order.
3.  **Run a Workflow**: Open the run panel, provide a prompt, and watch as the agents collaborate in real time to generate content.
4.  **Use the Co-Pilot**: Open any content document and use the AI Co-Pilot toolbar or keyboard shortcuts (`Mod+Shift+S` for suggest, `Mod+Shift+R` for rewrite) to get instant writing assistance.
