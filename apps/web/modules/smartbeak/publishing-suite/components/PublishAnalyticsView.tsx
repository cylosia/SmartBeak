"use client";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Button } from "@repo/ui/components/button";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { BarChart2Icon, EyeIcon, MousePointerClickIcon, HeartIcon, TrendingUpIcon } from "lucide-react";

export function PublishAnalyticsView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const analyticsQuery = useQuery(
    orpc.smartbeak.publishingSuite.analytics.queryOptions({
      input: { organizationSlug, domainId },
    }),
  );

  const data = analyticsQuery.data;
  const totals = data?.totals ?? { views: 0, engagement: 0, clicks: 0, impressions: 0, posts: 0 };
  const byPlatform = data?.byPlatform ?? {};

  const chartData = Object.entries(byPlatform).map(([platform, stats]) => ({
    platform,
    views: stats.views ?? 0,
    clicks: stats.clicks ?? 0,
    engagement: stats.engagement ?? 0,
    impressions: stats.impressions ?? 0,
  }));

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard title="Total Views" value={totals.views.toLocaleString()} icon={EyeIcon} loading={analyticsQuery.isLoading} />
          <MetricCard title="Clicks" value={totals.clicks.toLocaleString()} icon={MousePointerClickIcon} loading={analyticsQuery.isLoading} />
          <MetricCard title="Engagement" value={totals.engagement.toLocaleString()} icon={HeartIcon} loading={analyticsQuery.isLoading} />
          <MetricCard title="Impressions" value={totals.impressions.toLocaleString()} icon={TrendingUpIcon} loading={analyticsQuery.isLoading} />
        </div>

        {analyticsQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-destructive">Failed to load analytics.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => analyticsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : analyticsQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={BarChart2Icon}
            title="No analytics yet"
            description="Analytics will appear once content has been published and performance data returned."
          />
        ) : (
          <>
            {/* Bar chart */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Performance by Platform
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} className="capitalize" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="clicks" fill="hsl(var(--chart-2, 142 71% 45%))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="engagement" fill="hsl(var(--chart-3, 330 81% 60%))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-platform table */}
            <div className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Platform Breakdown</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Engagement</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.map((row) => {
                    const ctr = row.impressions > 0 ? ((row.clicks / row.impressions) * 100).toFixed(1) : "—";
                    return (
                      <TableRow key={row.platform}>
                        <TableCell className="font-medium capitalize">{row.platform}</TableCell>
                        <TableCell className="text-right">{byPlatform[row.platform]?.posts ?? 0}</TableCell>
                        <TableCell className="text-right">{(row.views || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{(row.clicks || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{(row.engagement || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{(row.impressions || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{ctr}{ctr !== "—" ? "%" : ""}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
