/**
 * SmartBeak Phase 3A — Health Check Endpoint
 *
 * GET /api/health
 *
 * Returns the health status of infrastructure components.
 * Used by load balancers, uptime monitors, and operational health tooling.
 *
 * Internal details (latency, error messages) are omitted to prevent
 * information disclosure to unauthenticated callers.
 */

import { checkDatabaseHealth } from "@repo/api/infrastructure";
import { NextResponse } from "next/server";

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
		},
		{ status: httpStatus },
	);
}
