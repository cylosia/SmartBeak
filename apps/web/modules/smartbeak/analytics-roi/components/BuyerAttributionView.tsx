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
	MousePointerClickIcon,
	TargetIcon,
	TrendingUpIcon,
	UsersIcon,
} from "lucide-react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";

const PIE_COLORS = [
	"hsl(var(--chart-1))",
	"hsl(var(--chart-2))",
	"hsl(var(--chart-3))",
	"hsl(var(--chart-4))",
	"hsl(var(--chart-5))",
];

export function BuyerAttributionView({
	organizationSlug,
	domainId,
}: {
	organizationSlug: string;
	domainId?: string;
}) {
	const isDomainLevel = !!domainId;

	const domainQuery = useQuery(
		orpc.smartbeak.analyticsRoi.getBuyerAttributionDomain.queryOptions({
			input: { organizationSlug, domainId: domainId! },
			enabled: isDomainLevel,
		}),
	);

	const orgQuery = useQuery(
		orpc.smartbeak.analyticsRoi.getBuyerAttributionOrg.queryOptions({
			input: { organizationSlug },
			enabled: !isDomainLevel,
		}),
	);

	const isLoading = isDomainLevel
		? domainQuery.isLoading
		: orgQuery.isLoading;
	const isError = isDomainLevel ? domainQuery.isError : orgQuery.isError;
	const _error = isDomainLevel ? domainQuery.error : orgQuery.error;

	if (isLoading) {
		return <CardGridSkeleton count={4} />;
	}
	if (isError) {
		return (
			<div className="flex flex-col items-center py-8 text-center">
				<p className="text-sm text-destructive">
					Failed to load buyer attribution data.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() =>
						isDomainLevel
							? domainQuery.refetch()
							: orgQuery.refetch()
					}
				>
					Retry
				</Button>
			</div>
		);
	}

	if (isDomainLevel) {
		const data = domainQuery.data;
		if (!data) {
			return null;
		}

		return (
			<ErrorBoundary>
				<div className="space-y-6">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<MetricCard
							title="Total Sessions"
							value={String(data.total)}
							icon={UsersIcon}
							subtitle="Unique buyer sessions"
						/>
						<MetricCard
							title="Converted"
							value={String(data.converted)}
							icon={MousePointerClickIcon}
							subtitle="Sessions with buyer email"
						/>
						<MetricCard
							title="Conversion Rate"
							value={`${data.conversionRate}%`}
							icon={TrendingUpIcon}
							subtitle="Sessions → identified buyers"
						/>
						<MetricCard
							title="Intent Types"
							value={String((data.intentBreakdown ?? []).length)}
							icon={TargetIcon}
							subtitle="Distinct buyer intents"
						/>
					</div>

					<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
						{/* Daily Trend */}
						<Card>
							<CardHeader>
								<CardTitle className="text-sm font-semibold">
									Daily Buyer Sessions
								</CardTitle>
								<CardDescription>
									30-day session trend
								</CardDescription>
							</CardHeader>
							<CardContent>
								{data.dailyTrend.length === 0 ? (
									<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
										No session data yet
									</div>
								) : (
									<ResponsiveContainer
										width="100%"
										height={200}
									>
										<AreaChart
											data={data.dailyTrend}
											margin={{
												top: 4,
												right: 8,
												left: -20,
												bottom: 0,
											}}
										>
											<defs>
												<linearGradient
													id="sessionGrad"
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
											/>
											<YAxis tick={{ fontSize: 10 }} />
											<Tooltip
												contentStyle={{
													background:
														"hsl(var(--card))",
													border: "1px solid hsl(var(--border))",
													borderRadius: 8,
												}}
											/>
											<Area
												type="monotone"
												dataKey="count"
												stroke="hsl(var(--primary))"
												fill="url(#sessionGrad)"
												strokeWidth={2}
											/>
										</AreaChart>
									</ResponsiveContainer>
								)}
							</CardContent>
						</Card>

						{/* Intent Breakdown Pie */}
						<Card>
							<CardHeader>
								<CardTitle className="text-sm font-semibold">
									Intent Breakdown
								</CardTitle>
								<CardDescription>
									Buyer intent distribution
								</CardDescription>
							</CardHeader>
							<CardContent>
								{(data.intentBreakdown ?? []).length === 0 ? (
									<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
										No intent data yet
									</div>
								) : (
									<ResponsiveContainer
										width="100%"
										height={200}
									>
										<PieChart>
											<Pie
												data={
													data.intentBreakdown ?? []
												}
												dataKey="count"
												nameKey="intent"
												cx="50%"
												cy="50%"
												outerRadius={80}
												label={({ name, percent }) =>
													`${name} ${((percent ?? 0) * 100).toFixed(0)}%`
												}
												labelLine={false}
											>
												{(
													data.intentBreakdown ?? []
												).map((_, i) => (
													<Cell
														key={`pie-${i}`}
														fill={
															PIE_COLORS[
																i %
																	PIE_COLORS.length
															]
														}
													/>
												))}
											</Pie>
											<Tooltip
												contentStyle={{
													background:
														"hsl(var(--card))",
													border: "1px solid hsl(var(--border))",
													borderRadius: 8,
												}}
											/>
										</PieChart>
									</ResponsiveContainer>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Session Table */}
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Recent Buyer Sessions
							</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Session ID</TableHead>
										<TableHead>Buyer Email</TableHead>
										<TableHead>Intent</TableHead>
										<TableHead>Date</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(data.sessions ?? [])
										.slice(0, 20)
										.map((s) => (
											<TableRow key={s.id}>
												<TableCell className="font-mono text-xs">
													{s.sessionId.slice(0, 12)}…
												</TableCell>
												<TableCell className="text-sm">
													{s.buyerEmail ?? (
														<span className="text-muted-foreground">
															Anonymous
														</span>
													)}
												</TableCell>
												<TableCell>
													{s.intent ? (
														<Badge
															status="info"
															className="text-xs"
														>
															{s.intent}
														</Badge>
													) : (
														<span className="text-muted-foreground text-xs">
															—
														</span>
													)}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{new Date(
														s.createdAt,
													).toLocaleDateString()}
												</TableCell>
												<TableCell>
													{s.buyerEmail ? (
														<Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 border text-xs">
															Converted
														</Badge>
													) : (
														<Badge className="bg-muted/50 text-muted-foreground text-xs">
															Anonymous
														</Badge>
													)}
												</TableCell>
											</TableRow>
										))}
									{data.sessions.length === 0 && (
										<TableRow>
											<TableCell
												colSpan={5}
												className="py-8 text-center text-muted-foreground"
											>
												No buyer sessions tracked yet.
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

	// Org-level view
	const orgData = orgQuery.data;
	if (!orgData) {
		return null;
	}

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<MetricCard
						title="Total Sessions"
						value={String(orgData.totalSessions)}
						icon={UsersIcon}
						subtitle="Across all domains"
					/>
					<MetricCard
						title="Total Converted"
						value={String(orgData.totalConverted)}
						icon={MousePointerClickIcon}
						subtitle="Identified buyer emails"
					/>
					<MetricCard
						title="Overall Conversion"
						value={`${orgData.overallConversionRate}%`}
						icon={TrendingUpIcon}
						subtitle="Portfolio-wide conversion rate"
					/>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-semibold">
							Attribution by Domain
						</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Domain</TableHead>
									<TableHead>Sessions</TableHead>
									<TableHead>Converted</TableHead>
									<TableHead>Conversion Rate</TableHead>
									<TableHead>Top Intent</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(orgData.domains ?? []).map((d) => {
									const topIntent = d.intentBreakdown.sort(
										(a, b) => b.count - a.count,
									)[0];
									return (
										<TableRow key={d.domain.id}>
											<TableCell className="font-medium">
												{d.domain.name}
											</TableCell>
											<TableCell>{d.total}</TableCell>
											<TableCell>{d.converted}</TableCell>
											<TableCell>
												<span
													className={
														d.conversionRate >= 20
															? "text-green-600 dark:text-green-400 font-medium"
															: "text-muted-foreground"
													}
												>
													{d.conversionRate}%
												</span>
											</TableCell>
											<TableCell>
												{topIntent ? (
													<Badge
														status="info"
														className="text-xs"
													>
														{topIntent.intent}
													</Badge>
												) : (
													"—"
												)}
											</TableCell>
										</TableRow>
									);
								})}
								{orgData.domains.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={5}
											className="py-8 text-center text-muted-foreground"
										>
											No attribution data yet.
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
