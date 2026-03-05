/**
 * Phase 3B — AI Co-Pilot Streaming API Route
 *
 * POST /api/ai/stream/copilot
 *
 * Handles inline AI co-pilot requests from the Tiptap editor.
 * Uses the Vercel AI SDK `streamText` with a structured prompt
 * based on the requested action.
 *
 * Actions:
 * - suggest: Continue writing from the current cursor position.
 * - rewrite: Rewrite the selected text to improve clarity and style.
 * - fact_check: Identify claims in the text that may need verification.
 * - optimize: Optimize the text for SEO and readability.
 * - shorten: Make the selected text more concise.
 * - expand: Expand the selected text with more detail.
 * - tone: Adjust the tone of the selected text.
 */

import { auth } from "@repo/auth";
import { createOpenAI, streamText } from "@repo/ai";
import { z } from "zod";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CopilotRequestSchema = z.object({
  action: z.enum([
    "suggest",
    "rewrite",
    "fact_check",
    "optimize",
    "shorten",
    "expand",
    "tone",
  ]),
  /** The selected text or text around the cursor. */
  selectedText: z.string().max(10000).optional(),
  /** The full document context (truncated). */
  documentContext: z.string().max(5000).optional(),
  /** The document title. */
  title: z.string().max(200).optional(),
  /** For tone action: the target tone. */
  targetTone: z
    .enum(["professional", "casual", "persuasive", "academic", "friendly"])
    .optional(),
});

const SYSTEM_PROMPT = `You are an expert AI writing co-pilot embedded in a content editor.
You help writers create better content by providing inline suggestions, rewrites, and improvements.
Always respond with clean, publication-ready text only — no explanations, no markdown wrappers,
no "Here is the rewritten version:" preambles. Just the improved text.`;

function buildPrompt(
  action: string,
  selectedText: string,
  documentContext: string,
  title: string,
  targetTone?: string,
): string {
  const contextBlock =
    documentContext.length > 0
      ? `\n\nDocument context (for reference):\n${documentContext}`
      : "";
  const titleBlock = title ? `\nDocument title: "${title}"` : "";

  switch (action) {
    case "suggest":
      return `${titleBlock}${contextBlock}\n\nContinue writing naturally from this point:\n${selectedText}\n\nWrite the next 1-3 sentences that flow naturally from the above.`;

    case "rewrite":
      return `${titleBlock}${contextBlock}\n\nRewrite the following text to improve clarity, flow, and impact while preserving the original meaning:\n\n${selectedText}`;

    case "fact_check":
      return `${titleBlock}${contextBlock}\n\nReview the following text and identify any specific factual claims that should be verified. For each claim, briefly explain why it needs verification. Format as a concise list:\n\n${selectedText}`;

    case "optimize":
      return `${titleBlock}${contextBlock}\n\nOptimize the following text for SEO and readability. Improve keyword usage, sentence structure, and engagement while keeping the same length:\n\n${selectedText}`;

    case "shorten":
      return `${titleBlock}${contextBlock}\n\nMake the following text more concise. Remove redundancy and filler words while preserving all key information:\n\n${selectedText}`;

    case "expand":
      return `${titleBlock}${contextBlock}\n\nExpand the following text with more detail, examples, and supporting information. Keep the same tone and style:\n\n${selectedText}`;

    case "tone":
      return `${titleBlock}${contextBlock}\n\nRewrite the following text in a ${targetTone ?? "professional"} tone while preserving the core message:\n\n${selectedText}`;

    default:
      return `${titleBlock}${contextBlock}\n\nImprove the following text:\n\n${selectedText}`;
  }
}

export async function POST(request: NextRequest) {
  // ── Authentication ──────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Parse and validate request ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const parsed = CopilotRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.flatten()), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    action,
    selectedText = "",
    documentContext = "",
    title = "",
    targetTone,
  } = parsed.data;

  if (!selectedText && action !== "suggest") {
    return new Response("selectedText is required for this action", {
      status: 400,
    });
  }

  // ── Stream AI response ──────────────────────────────────────────────────────
  const openai = createOpenAI({});
  const model = openai("gpt-4o-mini");
  const prompt = buildPrompt(
    action,
    selectedText,
    documentContext,
    title,
    targetTone,
  );

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 2048,
    temperature: action === "fact_check" ? 0.2 : 0.7,
  });

  return result.toTextStreamResponse();
}
