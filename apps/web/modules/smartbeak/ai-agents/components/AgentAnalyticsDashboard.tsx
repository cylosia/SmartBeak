"use client";

/**
 * Phase 3B — Agent Analytics Dashboard
 *
 * Displays usage, performance, and cost metrics for all AI agents
 * in an organization. Includes summary cards, per-workflow breakdown,
 * and a daily cost trend chart.
 */

import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ActivityIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  DollarSignIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Badge } from "@repo/ui/components/badge";
import { Skeleton } from "@repo/ui/components/skeleton";
import { orpc } from "@shared/lib/orpc-query-utils";

interface AgentAnalyticsDashboardProps {
  organizationSlug: string;
}

function MetricCard({
  title,
  value,
  sub,
  icon,
  trend,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && (
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            )}
          </div>
          <div className="rounded-lg bg-muted p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentAnalyticsDashboard({
  organizationSlug,
}: AgentAnalyticsDashboardProps) {
  

  const analyticsQuery = useQuery(
    orpc.aiAgents.getAnalytics.queryOptions({
      input: { organizationSlug },
    }),
  );

  const data = analyticsQuery.data as {
    summary: {
      totalSessions: number;
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      avgDurationMs: number;
      successRate: number;
      completedCount: number;
      failedCount: number;
    };
    workflowBreakdown: Array<{
      workflowId: string | null;
      workflowName: string;
      sessionCount: number;
      totalCostUsd: number;
      avgDurationMs: number;
    }>;
    dailyTrend: Array<{
      date: string;
      sessionCount: number;
      costUsd: number;
    }>;
  } | undefined;

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <BotIcon className="h-12 w-12 opacity-20" />
        <p>No analytics data yet. Run a workflow to get started.</p>
      </div>
    );
  }

  const { summary, workflowBreakdown, dailyTrend } = data;
  const avgDurationSec = (summary.avgDurationMs / 1000).toFixed(1);
  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          title="Total Sessions"
          value={summary.totalSessions.toLocaleString()}
          sub={`${summary.completedCount} completed · ${summary.failedCount} failed`}
          icon={<ActivityIcon className="h-5 w-5 text-muted-foreground" />}
        />
        <MetricCard
          title="Total Cost"
          value={`$${summary.totalCostUsd.toFixed(2)}`}
          sub="USD across all agents"
          icon={<DollarSignIcon className="h-5 w-5 text-muted-foreground" />}
        />
        <MetricCard
          title="Success Rate"
          value={`${summary.successRate}%`}
          sub={`${totalTokens.toLocaleString()} total tokens`}
          icon={<CheckCircle2Icon className="h-5 w-5 text-muted-foreground" />}
        />
        <MetricCard
          title="Avg Duration"
          value={`${avgDurationSec}s`}
          sub="per workflow run"
          icon={<ClockIcon className="h-5 w-5 text-muted-foreground" />}
        />
      </div>

      {/* Daily Cost Trend */}
      {dailyTrend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUpIcon className="h-4 w-4" />
              Daily Cost Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={dailyTrend}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) =>
                    new Date(v).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Tooltip
                  formatter={(value: number) => [
                    `$${value.toFixed(4)}`,
                    "Cost",
                  ]}
                  labelFormatter={(label: string) =>
                    new Date(label).toLocaleDateString()
                  }
                />
                <Area
                  type="monotone"
                  dataKey="costUsd"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#costGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Workflow Breakdown */}
      {workflowBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BotIcon className="h-4 w-4" />
              Workflow Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Avg Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflowBreakdown.map((w) => (
                  <TableRow key={w.workflowId ?? "adhoc"}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <BotIcon className="h-4 w-4 text-muted-foreground" />
                        {w.workflowName}
                        {!w.workflowId && (
                          <Badge status="info" className="text-xs">
                            Ad-hoc
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {w.sessionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      ${w.totalCostUsd.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(w.avgDurationMs / 1000).toFixed(1)}s
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {summary.totalSessions === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ActivityIcon className="h-10 w-10 opacity-20" />
          <p className="text-sm">
            No sessions yet. Run a workflow to see analytics here.
          </p>
        </div>
      )}
    </div>
  );
}
