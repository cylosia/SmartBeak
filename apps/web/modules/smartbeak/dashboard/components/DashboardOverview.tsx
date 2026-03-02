"use client";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { orpc } from "@shared/lib/orpc-query-utils";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton, TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  GlobeIcon,
  FileTextIcon,
  ImageIcon,
  TrendingUpIcon,
  ActivityIcon,
  ZapIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@repo/ui/components/button";

// Mock chart data — in production these would come from materialized views
const MOCK_PUBLISH_DATA = [
  { month: "Jan", jobs: 4 },
  { month: "Feb", jobs: 7 },
  { month: "Mar", jobs: 12 },
  { month: "Apr", jobs: 9 },
  { month: "May", jobs: 15 },
  { month: "Jun", jobs: 21 },
];

const MOCK_TRAFFIC_DATA = [
  { day: "Mon", visits: 120 },
  { day: "Tue", visits: 145 },
  { day: "Wed", visits: 98 },
  { day: "Thu", visits: 210 },
  { day: "Fri", visits: 185 },
  { day: "Sat", visits: 90 },
  { day: "Sun", visits: 75 },
];

export function DashboardOverview({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const domainsQuery = useQuery(
    orpc.smartbeak.domains.list.queryOptions({
      input: { organizationSlug, limit: 5, offset: 0 },
    }),
  );

  const portfolioQuery = useQuery(
    orpc.smartbeak.portfolio.getSummary.queryOptions({
      input: { organizationSlug },
    }),
  );

  const billingQuery = useQuery(
    orpc.smartbeak.billing.get.queryOptions({
      input: { organizationSlug },
    }),
  );

  const isLoading =
    domainsQuery.isLoading ||
    portfolioQuery.isLoading ||
    billingQuery.isLoading;

  const summary = portfolioQuery.data?.summary;
  const subscription = billingQuery.data?.subscription;

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Metric Cards */}
        {isLoading ? (
          <CardGridSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Total Domains"
              value={summary?.totalDomains ?? domainsQuery.data?.total ?? 0}
              subtitle="Managed properties"
              icon={GlobeIcon}
              trend={{ value: 12, label: "vs last month" }}
            />
            <MetricCard
              title="Portfolio Value"
              value={
                summary?.totalValue
                  ? `$${Number(summary.totalValue).toLocaleString()}`
                  : "—"
              }
              subtitle="Estimated total value"
              icon={TrendingUpIcon}
              trend={{ value: 8.4, label: "vs last quarter" }}
            />
            <MetricCard
              title="Avg. ROI"
              value={
                summary?.avgRoi ? `${summary.avgRoi}%` : "—"
              }
              subtitle="Across all domains"
              icon={ActivityIcon}
              trend={{ value: 3.2, label: "vs last month" }}
            />
            <MetricCard
              title="Plan"
              value={subscription?.plan ?? "Free"}
              subtitle={
                subscription?.status
                  ? `Status: ${subscription.status}`
                  : "No active subscription"
              }
              icon={ZapIcon}
            />
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Publishing Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={MOCK_PUBLISH_DATA}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="jobs"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Traffic Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={MOCK_TRAFFIC_DATA}>
                  <defs>
                    <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
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
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="visits"
                    stroke="hsl(var(--primary))"
                    fill="url(#trafficGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Recent Domains */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Recent Domains</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/app/${organizationSlug}/domains`}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {domainsQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : domainsQuery.data?.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No domains yet.{" "}
                <Link
                  href={`/app/${organizationSlug}/domains`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Add your first domain
                </Link>
              </p>
            ) : (
              <div className="divide-y divide-border">
                {domainsQuery.data?.items.map((domain) => (
                  <div
                    key={domain.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                        <GlobeIcon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{domain.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {domain.slug}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          domain.status === "active"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : domain.status === "deployed"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}
                      >
                        {domain.status}
                      </span>
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`/app/${organizationSlug}/domains/${domain.id}/content`}
                        >
                          Open
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* SmartDeploy Stub Card */}
        <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ZapIcon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold">SmartDeploy</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              One-click site deployment engine. Powered by edge infrastructure
              for instant global publishing.
            </p>
            <Button className="mt-4" asChild>
              <Link href={`/app/${organizationSlug}/smart-deploy`}>
                Deploy Site
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
