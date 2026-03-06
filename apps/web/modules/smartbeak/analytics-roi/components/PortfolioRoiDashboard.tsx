"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/ui/components/table";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import {
	ActivityIcon,
	AlertTriangleIcon,
	DollarSignIcon,
	GlobeIcon,
	TrendingUpIcon,
} from "lucide-react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";

function RiskBadge({ score }: { score: number }) {
	if (score >= 75) {
		return (
			<Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20">
				Low Risk
			</Badge>
		);
	}
	if (score >= 50) {
		return (
			<Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20">
				Medium Risk
			</Badge>
		);
	}
	return (
		<Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20">
			High Risk
		</Badge>
	);
}

export function PortfolioRoiDashboard({
	organizationSlug,
}: {
	organizationSlug: string;
}) {
	const roiQuery = useQuery(
		orpc.smartbeak.analyticsRoi.getPortfolioRoi.queryOptions({
			input: { organizationSlug },
		}),
	);

	const trendQuery = useQuery(
		orpc.smartbeak.analyticsRoi.getPortfolioTrend.queryOptions({
			input: { organizationSlug, days: 30 },
		}),
	);

	if (roiQuery.isLoading) {
		return <CardGridSkeleton count={4} />;
	}
	if (roiQuery.isError) {
		return (
			<div className="flex flex-col items-center py-8 text-center">
				<p className="text-sm text-destructive">
					Failed to load portfolio ROI data.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() => roiQuery.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const data = roiQuery.data;
	if (!data) {
		return null;
	}

	const trendData = trendQuery.data?.trend ?? [];

	const topDomains = [...(data.domains ?? [])]
		.sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore)
		.slice(0, 10);

	const barData = topDomains.map((d) => ({
		name:
			(d.name ?? "").length > 20
				? `${(d.name ?? "").slice(0, 18)}…`
				: (d.name ?? ""),
		value: d.riskAdjustedScore,
		estimatedValue: Math.round(Number(d.estimatedValue) || 0),
	}));

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Metric Cards */}
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard
						title="Total Portfolio Value"
						value={`$${((data.totalValue ?? 0) / 1000).toFixed(1)}K`}
						icon={DollarSignIcon}
						subtitle="Risk-adjusted estimated value"
					/>
					<MetricCard
						title="Average ROI Score"
						value={`${(data.avgRoi ?? 0).toFixed(1)}`}
						icon={TrendingUpIcon}
						subtitle="Weighted health × decay factor"
					/>
					<MetricCard
						title="Total Domains"
						value={String(data.totalDomains)}
						icon={GlobeIcon}
						subtitle="Active domains in portfolio"
					/>
					<MetricCard
						title="Portfolio Health Index"
						value={`${Math.round(data.avgRoi ?? 0)}%`}
						icon={ActivityIcon}
						subtitle="Overall portfolio health"
					/>
				</div>

				{/* Charts Row */}
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					{/* Risk-Adjusted Score Bar Chart */}
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Risk-Adjusted Scores
							</CardTitle>
							<CardDescription>
								Top 10 domains by risk-adjusted ROI score
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ResponsiveContainer width="100%" height={220}>
								<BarChart
									data={barData}
									margin={{
										top: 4,
										right: 8,
										left: -20,
										bottom: 0,
									}}
								>
									<CartesianGrid
										strokeDasharray="3 3"
										className="stroke-border"
									/>
									<XAxis
										dataKey="name"
										tick={{ fontSize: 10 }}
										className="fill-muted-foreground"
									/>
									<YAxis
										tick={{ fontSize: 10 }}
										className="fill-muted-foreground"
									/>
									<Tooltip
										contentStyle={{
											background: "hsl(var(--card))",
											border: "1px solid hsl(var(--border))",
											borderRadius: 8,
										}}
										labelStyle={{
											color: "hsl(var(--foreground))",
										}}
									/>
									<Bar dataKey="value" radius={[4, 4, 0, 0]}>
										{barData.map((entry, index) => (
											<Cell
												key={`bar-${entry.name}-${index}`}
												fill={
													entry.value >= 75
														? "hsl(var(--chart-1))"
														: entry.value >= 50
															? "hsl(var(--chart-3))"
															: "hsl(var(--chart-5))"
												}
											/>
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</CardContent>
					</Card>

					{/* Portfolio Decay Trend */}
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Portfolio Decay Trend
							</CardTitle>
							<CardDescription>
								Average monetization decay factor over 30 days
							</CardDescription>
						</CardHeader>
						<CardContent>
							{trendQuery.isError ? (
								<div className="flex flex-col items-center justify-center py-8 gap-3">
									<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
									<p className="text-sm text-destructive">
										Failed to load trend data
									</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => trendQuery.refetch()}
									>
										Try Again
									</Button>
								</div>
							) : trendData.length === 0 ? (
								<div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
									No trend data available yet
								</div>
							) : (
								<ResponsiveContainer width="100%" height={220}>
									<AreaChart
										data={trendData}
										margin={{
											top: 4,
											right: 8,
											left: -20,
											bottom: 0,
										}}
									>
										<defs>
											<linearGradient
												id="decayGradient"
												x1="0"
												y1="0"
												x2="0"
												y2="1"
											>
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
										/>
										<XAxis
											dataKey="date"
											tick={{ fontSize: 10 }}
											className="fill-muted-foreground"
										/>
										<YAxis
											domain={[0, 1]}
											tick={{ fontSize: 10 }}
											className="fill-muted-foreground"
										/>
										<Tooltip
											contentStyle={{
												background: "hsl(var(--card))",
												border: "1px solid hsl(var(--border))",
												borderRadius: 8,
											}}
										/>
										<Area
											type="monotone"
											dataKey="avgDecay"
											stroke="hsl(var(--primary))"
											fill="url(#decayGradient)"
											strokeWidth={2}
										/>
									</AreaChart>
								</ResponsiveContainer>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Domain Table */}
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-semibold">
							Domain Portfolio Breakdown
						</CardTitle>
						<CardDescription>
							All domains with risk-adjusted scores and estimated
							values
						</CardDescription>
					</CardHeader>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Domain</TableHead>
									<TableHead>Health Score</TableHead>
									<TableHead>Decay Factor</TableHead>
									<TableHead>Risk-Adjusted Score</TableHead>
									<TableHead>Est. Value</TableHead>
									<TableHead>Risk Level</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(data.domains ?? []).map((domain) => (
									<TableRow key={domain.id}>
										<TableCell className="font-medium">
											{domain.name}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Progress
													value={
														domain.healthScore ?? 0
													}
													className="h-1.5 w-20"
												/>
												<span className="text-xs text-muted-foreground">
													{domain.healthScore ?? 0}
												</span>
											</div>
										</TableCell>
										<TableCell>
											<span
												className={
													(domain.decayFactor ?? 0) >=
													0.7
														? "text-green-600 dark:text-green-400"
														: (domain.decayFactor ??
																	0) >= 0.4
															? "text-amber-600 dark:text-amber-400"
															: "text-red-600 dark:text-red-400"
												}
											>
												{(
													(domain.decayFactor ?? 0) *
													100
												).toFixed(1)}
												%
											</span>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Progress
													value={
														domain.riskAdjustedScore ??
														0
													}
													className="h-1.5 w-20"
												/>
												<span className="text-xs font-medium">
													{(
														domain.riskAdjustedScore ??
														0
													).toFixed(1)}
												</span>
											</div>
										</TableCell>
										<TableCell className="font-medium">
											$
											{(
												Number(domain.estimatedValue) ||
												0
											).toLocaleString()}
										</TableCell>
										<TableCell>
											<RiskBadge
												score={domain.riskAdjustedScore}
											/>
										</TableCell>
									</TableRow>
								))}
								{(data.domains ?? []).length === 0 && (
									<TableRow>
										<TableCell
											colSpan={6}
											className="py-8 text-center text-muted-foreground"
										>
											No domains found. Add domains to see
											portfolio analytics.
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
