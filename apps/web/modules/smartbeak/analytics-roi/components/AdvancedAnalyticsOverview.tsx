"use client";

import { useQuery } from "@tanstack/react-query";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { orpc } from "@shared/lib/orpc-query-utils";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { Badge } from "@repo/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { ActivityIcon, TrendingDownIcon, TrendingUpIcon, ShieldIcon } from "lucide-react";

export function AdvancedAnalyticsOverview({ organizationSlug }: { organizationSlug: string }) {
  const overviewQuery = useQuery(
    orpc.smartbeak.analyticsRoi.getOverview.queryOptions({
      input: { organizationSlug },
    }),
  );

  const decayQuery = useQuery(
    orpc.smartbeak.analyticsRoi.getMonetizationDecay.queryOptions({
      input: { organizationSlug },
    }),
  );

  if (overviewQuery.isLoading) return <CardGridSkeleton count={4} />;
  if (overviewQuery.isError) return <ErrorBoundary error={overviewQuery.error} />;

  const overview = overviewQuery.data;
  if (!overview) return null;

  const decayDomains = decayQuery.data?.domains ?? [];

  // Radar chart data for portfolio health dimensions
  const radarData = [
    { subject: "Health", value: Math.round(overview.roi.avgRoi) },
    { subject: "Diligence", value: 0 }, // populated from diligence if available
    { subject: "Buyer Interest", value: Math.min(overview.attribution.totalSessions * 2, 100) },
    { subject: "Conversion", value: overview.attribution.overallConversionRate },
    { subject: "Monetization", value: Math.round(decayDomains.reduce((s, d) => s + d.avgDecay, 0) / Math.max(decayDomains.length, 1) * 100) },
    { subject: "Portfolio Size", value: Math.min(overview.roi.totalDomains * 10, 100) },
  ];

  // Decay bar chart
  const decayBarData = decayDomains
    .sort((a, b) => a.avgDecay - b.avgDecay)
    .slice(0, 10)
    .map((d) => ({
      name: d.domain.name.length > 16 ? d.domain.name.slice(0, 14) + "…" : d.domain.name,
      decay: Math.round(d.avgDecay * 100),
    }));

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Portfolio Health Index"
            value={`${overview.portfolioHealthIndex}%`}
            icon={<ShieldIcon className="h-4 w-4" />}
            description="Composite health score"
          />
          <MetricCard
            title="Total Portfolio Value"
            value={`$${(overview.roi.totalValue / 1000).toFixed(1)}K`}
            icon={<TrendingUpIcon className="h-4 w-4" />}
            description="Risk-adjusted estimate"
          />
          <MetricCard
            title="Avg Monetization Decay"
            value={`${Math.round(decayDomains.reduce((s, d) => s + d.avgDecay, 0) / Math.max(decayDomains.length, 1) * 100)}%`}
            icon={<TrendingDownIcon className="h-4 w-4" />}
            description="Lower = more decay risk"
          />
          <MetricCard
            title="Buyer Sessions"
            value={String(overview.attribution.totalSessions)}
            icon={<ActivityIcon className="h-4 w-4" />}
            description={`${overview.attribution.overallConversionRate}% conversion rate`}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Portfolio Radar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Portfolio Health Radar</CardTitle>
              <CardDescription>Multi-dimensional portfolio assessment</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData}>
                  <PolarGrid className="stroke-border" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <Radar
                    name="Portfolio"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monetization Decay Bar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Monetization Decay by Domain</CardTitle>
              <CardDescription>Domains with lowest decay (highest risk first)</CardDescription>
            </CardHeader>
            <CardContent>
              {decayBarData.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  No decay data available yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={decayBarData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Bar dataKey="decay" radius={[0, 4, 4, 0]}>
                      {decayBarData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.decay >= 70 ? "hsl(var(--chart-1))" : entry.decay >= 40 ? "hsl(var(--chart-3))" : "hsl(var(--chart-5))"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monetization Decay Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Monetization Decay Signals</CardTitle>
            <CardDescription>All domains with their average decay factor and signal count</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Health Score</TableHead>
                  <TableHead>Avg Decay Factor</TableHead>
                  <TableHead>Signal Count</TableHead>
                  <TableHead>Risk Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decayDomains.map((d) => {
                  const decayPct = Math.round(d.avgDecay * 100);
                  const riskLabel = decayPct >= 70 ? "Low" : decayPct >= 40 ? "Medium" : "High";
                  const riskColor = decayPct >= 70
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                    : decayPct >= 40
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
                  return (
                    <TableRow key={d.domain.id}>
                      <TableCell className="font-medium">{d.domain.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={d.domain.healthScore ?? 0} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground">{d.domain.healthScore ?? 0}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={decayPct >= 70 ? "text-green-600 dark:text-green-400 font-medium" : decayPct >= 40 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                          {decayPct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.signals.length}</TableCell>
                      <TableCell>
                        <Badge className={`border text-xs ${riskColor}`}>{riskLabel} Risk</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {decayDomains.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No decay signals recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
