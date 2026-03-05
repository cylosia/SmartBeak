/**
 * SmartBeak Phase 3A — Health Check Endpoint
 *
 * GET /api/health
 *
 * Returns the health status of all infrastructure components.
 * Used by load balancers, uptime monitors, and SOC2 compliance tooling.
 */

import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@repo/api/infrastructure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbHealth = await checkDatabaseHealth();

  const status = dbHealth.healthy ? "healthy" : "degraded";
  const httpStatus = dbHealth.healthy ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "unknown",
      services: {
        database: {
          healthy: dbHealth.healthy,
          latencyMs: dbHealth.latencyMs,
          ...(dbHealth.error && { error: dbHealth.error }),
        },
        cache: {
          // Cache is always "available" — it falls back to in-memory.
          healthy: true,
          backend: process.env.REDIS_URL ? "redis" : "in-memory",
        },
      },
    },
    { status: httpStatus },
  );
}
