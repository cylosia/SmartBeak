/**
 * Phase 3B — Workflow Streaming API Route
 *
 * GET /api/ai/stream/workflow?sessionId=<uuid>
 *
 * Executes a workflow session and streams progress events back to the client
 * as Server-Sent Events (SSE). The session must have been created first via
 * the `initiateWorkflowRun` orpc procedure.
 *
 * Event types:
 * - session_start: Workflow execution has begun.
 * - node_start: An agent node has started executing.
 * - node_stream: A text chunk from the current agent.
 * - node_complete: An agent node has finished.
 * - session_complete: All agents have finished; includes final output.
 * - error: An error occurred during execution.
 */

import { auth } from "@repo/auth";
import {
  claimSession,
  getSessionById,
  getWorkflowById,
  updateSession,
  WorkflowGraphSchema,
} from "@repo/database";
import { executeWorkflow } from "@repo/api/modules/ai-agents/lib/agent-executor";
import { logger } from "@repo/logs";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ── Authentication ──────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return new Response("Missing or invalid sessionId parameter", { status: 400 });
  }

  const agentSession = await getSessionById(sessionId);
  if (!agentSession) {
    return new Response("Session not found", { status: 404 });
  }

  if (agentSession.triggeredBy !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  if (agentSession.status !== "pending") {
    return new Response(
      JSON.stringify({ error: "Session is not in pending state", status: agentSession.status }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  const claimed = await claimSession(sessionId);
  if (!claimed) {
    return new Response(
      JSON.stringify({ error: "Session already claimed by another request" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Load workflow ───────────────────────────────────────────────────────────
  if (!agentSession.workflowId) {
    return new Response("Session has no associated workflow", { status: 400 });
  }

  const workflow = await getWorkflowById(agentSession.workflowId);
  if (!workflow) {
    return new Response("Workflow not found", { status: 404 });
  }

  const graph = WorkflowGraphSchema.safeParse(workflow.stepsJson);
  if (!graph.success) {
    return new Response("Invalid workflow graph", { status: 400 });
  }

  const inputData = agentSession.inputData as {
    prompt?: string;
    context?: string;
  };
  const prompt = inputData.prompt ?? "";
  const context = inputData.context;

  // ── Stream SSE ──────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client disconnected
        }
      };

      try {
        for await (const event of executeWorkflow(
          sessionId,
          graph.data,
          prompt,
          context,
        )) {
          if (abortController.signal.aborted) {
            logger.info("[workflow-stream] client disconnected, aborting");
            break;
          }
          send(event);
          if (
            event.type === "session_complete" ||
            event.type === "error"
          ) {
            break;
          }
        }
      } catch (err) {
        logger.error("[workflow-stream] execution error:", err);
        send({
          type: "error",
          error: "Execution failed. Please try again.",
        });
        await updateSession(sessionId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Execution failed",
        }).catch(() => {});
      } finally {
        if (abortController.signal.aborted) {
          await updateSession(sessionId, {
            status: "failed",
            errorMessage: "Client disconnected",
          }).catch(() => {});
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
