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
	ShieldIcon,
	TrendingDownIcon,
	TrendingUpIcon,
} from "lucide-react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	PolarAngleAxis,
	PolarGrid,
	Radar,
	RadarChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";

function clampPercent(value: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, value));
}

export function AdvancedAnalyticsOverview({
	organizationSlug,
}: {
	organizationSlug: string;
}) {
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

	if (overviewQuery.isLoading) {
		return <CardGridSkeleton count={4} />;
	}
	if (overviewQuery.isError) {
		return (
			<div className="flex flex-col items-center py-8 text-center">
				<p className="text-sm text-destructive">
					Failed to load analytics overview.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() => overviewQuery.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const overview = overviewQuery.data;
	if (!overview) {
		return null;
	}

	const roi = overview.roi ?? { avgRoi: 0, totalScore: 0, totalDomains: 0 };
	const attribution = overview.attribution ?? {
		totalSessions: 0,
		overallIdentifiedBuyerRate: 0,
	};
	const decayDomains = decayQuery.data?.domains ?? [];
	const avgDecayPercent = clampPercent(
		Math.round(
			(decayDomains.reduce((s, d) => s + d.avgDecay, 0) /
				Math.max(decayDomains.length, 1)) *
				100,
		),
	);

	const radarData = [
		{ subject: "Health", value: clampPercent(Math.round(roi.avgRoi)) },
		{
			subject: "Buyer Interest",
			value: clampPercent(attribution.totalSessions * 2),
		},
		{
			subject: "Identification",
			value: clampPercent(attribution.overallIdentifiedBuyerRate),
		},
		{
			subject: "Monetization",
			value: avgDecayPercent,
		},
		{
			subject: "Portfolio Size",
			value: clampPercent(roi.totalDomains * 10),
		},
	];

	// Decay bar chart
	const decayBarData = [...decayDomains]
		.sort((a, b) => a.avgDecay - b.avgDecay)
		.slice(0, 10)
		.map((d) => ({
			id: d.domain.id,
			name:
				(d.domain?.name ?? "").length > 16
					? `${(d.domain?.name ?? "").slice(0, 14)}…`
					: (d.domain?.name ?? ""),
			decay: Math.round(d.avgDecay * 100),
		}));

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Top Metrics */}
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard
						title="Portfolio Health Index"
						value={`${overview.portfolioHealthIndex ?? 0}%`}
						icon={ShieldIcon}
						subtitle="Composite health score"
					/>
					<MetricCard
						title="Total Portfolio Score"
						value={roi.totalScore.toFixed(1)}
						icon={TrendingUpIcon}
						subtitle="Aggregate risk-adjusted score"
					/>
					<MetricCard
						title="Avg Monetization Decay"
						value={`${avgDecayPercent}%`}
						icon={TrendingDownIcon}
						subtitle="Lower = more decay risk"
					/>
					<MetricCard
						title="Buyer Sessions"
						value={String(attribution.totalSessions)}
						icon={ActivityIcon}
						subtitle={`${attribution.overallIdentifiedBuyerRate}% identified buyer rate`}
					/>
				</div>

				{/* Charts Row */}
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					{/* Portfolio Radar */}
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Portfolio Health Radar
							</CardTitle>
							<CardDescription>
								Portfolio assessment from available portfolio,
								buyer-session, and monetization data
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ResponsiveContainer width="100%" height={240}>
								<RadarChart data={radarData}>
									<PolarGrid className="stroke-border" />
									<PolarAngleAxis
										dataKey="subject"
										tick={{ fontSize: 11 }}
										className="fill-muted-foreground"
									/>
									<Radar
										name="Portfolio"
										dataKey="value"
										stroke="hsl(var(--primary))"
										fill="hsl(var(--primary))"
										fillOpacity={0.2}
										strokeWidth={2}
									/>
									<Tooltip
										contentStyle={{
											background: "hsl(var(--card))",
											border: "1px solid hsl(var(--border))",
											borderRadius: 8,
										}}
									/>
								</RadarChart>
							</ResponsiveContainer>
						</CardContent>
					</Card>

					{/* Monetization Decay Bar */}
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Monetization Decay by Domain
							</CardTitle>
							<CardDescription>
								Domains with lowest decay (highest risk first)
							</CardDescription>
						</CardHeader>
						<CardContent>
							{decayQuery.isError ? (
								<div className="flex flex-col items-center justify-center py-8 gap-3">
									<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
									<p className="text-sm text-destructive">
										Failed to load decay data
									</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => decayQuery.refetch()}
									>
										Try Again
									</Button>
								</div>
							) : decayBarData.length === 0 ? (
								<div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
									No decay data available yet
								</div>
							) : (
								<ResponsiveContainer width="100%" height={240}>
									<BarChart
										data={decayBarData}
										layout="vertical"
										margin={{
											top: 4,
											right: 16,
											left: 0,
											bottom: 0,
										}}
									>
										<CartesianGrid
											strokeDasharray="3 3"
											className="stroke-border"
											horizontal={false}
										/>
										<XAxis
											type="number"
											domain={[0, 100]}
											tick={{ fontSize: 10 }}
										/>
										<YAxis
											type="category"
											dataKey="name"
											tick={{ fontSize: 10 }}
											width={90}
										/>
										<Tooltip
											contentStyle={{
												background: "hsl(var(--card))",
												border: "1px solid hsl(var(--border))",
												borderRadius: 8,
											}}
										/>
										<Bar
											dataKey="decay"
											radius={[0, 4, 4, 0]}
										>
											{decayBarData.map((entry, i) => (
												<Cell
													key={`decay-${entry.id ?? i}`}
													fill={
														entry.decay >= 70
															? "hsl(var(--chart-1))"
															: entry.decay >= 40
																? "hsl(var(--chart-3))"
																: "hsl(var(--chart-5))"
													}
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
						<CardTitle className="text-sm font-semibold">
							Monetization Decay Signals
						</CardTitle>
						<CardDescription>
							All domains with their average decay factor and
							signal count
						</CardDescription>
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
									const decayPct = clampPercent(
										Math.round(d.avgDecay * 100),
									);
									const healthScore = clampPercent(
										Number(
											(
												d.domain.health as Record<
													string,
													unknown
												> | null
											)?.score ?? 0,
										),
									);
									const riskLabel =
										decayPct >= 70
											? "Low"
											: decayPct >= 40
												? "Medium"
												: "High";
									const riskColor =
										decayPct >= 70
											? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
											: decayPct >= 40
												? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
												: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
									return (
										<TableRow key={d.domain.id}>
											<TableCell className="font-medium">
												{d.domain.name}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<Progress
														value={healthScore}
														className="h-1.5 w-16"
													/>
													<span className="text-xs text-muted-foreground">
														{healthScore}
													</span>
												</div>
											</TableCell>
											<TableCell>
												<span
													className={
														decayPct >= 70
															? "text-green-600 dark:text-green-400 font-medium"
															: decayPct >= 40
																? "text-amber-600 dark:text-amber-400 font-medium"
																: "text-red-600 dark:text-red-400 font-medium"
													}
												>
													{decayPct}%
												</span>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{d.signals.length}
											</TableCell>
											<TableCell>
												<Badge
													className={`border text-xs ${riskColor}`}
												>
													{riskLabel} Risk
												</Badge>
											</TableCell>
										</TableRow>
									);
								})}
								{decayDomains.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={5}
											className="py-8 text-center text-muted-foreground"
										>
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
