"use client";
import { useQuery } from "@tanstack/react-query";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { orpc } from "@shared/lib/orpc-query-utils";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import {
  TrendingUpIcon,
  DollarSignIcon,
  ShieldCheckIcon,
  UsersIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "lucide-react";

const RADAR_DATA = [
  { subject: "Traffic", value: 82 },
  { subject: "Revenue", value: 65 },
  { subject: "Content", value: 91 },
  { subject: "SEO", value: 74 },
  { subject: "Tech", value: 88 },
  { subject: "Brand", value: 70 },
];

const BUYER_PIE_DATA = [
  { name: "Organic Search", value: 45, color: "hsl(var(--primary))" },
  { name: "Direct", value: 25, color: "hsl(var(--chart-2))" },
  { name: "Referral", value: 18, color: "hsl(var(--chart-3))" },
  { name: "Social", value: 12, color: "hsl(var(--chart-4))" },
];

const SELL_READY_CHECKS = [
  { label: "Clean revenue history", pass: true },
  { label: "No pending legal issues", pass: true },
  { label: "Traffic trend positive", pass: true },
  { label: "Content freshness > 80%", pass: false },
  { label: "DNS verified", pass: true },
  { label: "Monetization active", pass: false },
];

export function PortfolioView({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const portfolioQuery = useQuery(
    orpc.smartbeak.portfolio.getSummary.queryOptions({
      input: { organizationSlug },
    }),
  );

  const summary = portfolioQuery.data?.summary;

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Metric Cards */}
        {portfolioQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-destructive">Failed to load portfolio data.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => portfolioQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : portfolioQuery.isLoading ? (
          <CardGridSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Portfolio Value"
              value={
                summary?.totalValue
                  ? `$${Number(summary.totalValue).toLocaleString()}`
                  : "$0"
              }
              subtitle="Estimated total"
              icon={DollarSignIcon}
              trend={{ value: 12.4, label: "vs last quarter" }}
            />
            <MetricCard
              title="Average ROI"
              value={summary?.avgRoi ? `${summary.avgRoi}%` : "—"}
              subtitle="Across all domains"
              icon={TrendingUpIcon}
              trend={{ value: 3.1, label: "vs last month" }}
            />
            <MetricCard
              title="Total Domains"
              value={summary?.totalDomains ?? 0}
              subtitle="Active properties"
              icon={ShieldCheckIcon}
            />
            <MetricCard
              title="Sell-Ready Score"
              value={`${Math.round((SELL_READY_CHECKS.filter((c) => c.pass).length / SELL_READY_CHECKS.length) * 100)}%`}
              subtitle={`${SELL_READY_CHECKS.filter((c) => c.pass).length} of ${SELL_READY_CHECKS.length} checks passing`}
              icon={UsersIcon}
              trend={{ value: -5, label: "vs last month" }}
            />
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Diligence Radar */}
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Diligence Radar
              </CardTitle>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                Sample data
              </span>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={RADAR_DATA}>
                  <PolarGrid className="stroke-border" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <Radar
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Buyer Attribution Pie */}
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Buyer Attribution
              </CardTitle>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                Sample data
              </span>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={BUYER_PIE_DATA}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {BUYER_PIE_DATA.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {BUYER_PIE_DATA.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {entry.name} ({entry.value}%)
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sell-Ready Checklist */}
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Sell-Ready Checklist
              </CardTitle>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                Sample data
              </span>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {SELL_READY_CHECKS.map((check) => (
                  <div
                    key={check.label}
                    className="flex items-center gap-2.5"
                  >
                    {check.pass ? (
                      <CheckCircleIcon className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertCircleIcon className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    )}
                    <span
                      className={`text-sm ${
                        check.pass
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {check.label}
                    </span>
                    {!check.pass && (
                      <Badge
                        variant="outline"
                        className="ml-auto text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700"
                      >
                        Action needed
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Overall score</span>
                  <span className="text-sm font-bold text-primary">
                    {SELL_READY_CHECKS.filter((c) => c.pass).length} /{" "}
                    {SELL_READY_CHECKS.length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ErrorBoundary>
  );
}
