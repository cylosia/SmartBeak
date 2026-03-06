import { logger } from "@repo/logs";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown";
    const stack = typeof body.stack === "string" ? body.stack.slice(0, 2000) : undefined;
    const componentStack = typeof body.componentStack === "string" ? body.componentStack.slice(0, 2000) : undefined;

    logger.error("[client-error]", { message, stack, componentStack });
  } catch {
    // Malformed request — ignore
  }

  return new Response(null, { status: 204 });
}
