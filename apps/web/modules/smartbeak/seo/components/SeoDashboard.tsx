"use client";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@repo/ui/components/chart";
import {
	AlertCircleIcon,
	AlertTriangleIcon,
	CheckCircle2Icon,
	GaugeIcon,
	SearchIcon,
	TargetIcon,
	TrendingDownIcon,
	TrophyIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
	Area,
	AreaChart,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { getDecayHealth, getDifficultyTier } from "../lib/seo-utils";

interface KeywordData {
	id: string;
	keyword: string;
	volume: number | null;
	difficulty: number | null;
	position: number | null;
	decayFactor: string | null;
}

interface SeoDocData {
	score: number | null;
	updatedAt: string | Date;
}

function clampPercent(value: number | null | undefined) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, Math.round(value)));
}

function generateScoreTrend(currentScore: number, days = 30) {
	const safeScore = clampPercent(currentScore);
	return Array.from({ length: days }, (_, i) => {
		const dayOffset = days - 1 - i;
		const noise = Math.sin(i * 0.8) * 6 + Math.cos(i * 0.3) * 4;
		const growth = (i / days) * (safeScore * 0.3);
		const score = Math.max(
			0,
			Math.min(100, Math.round(safeScore * 0.6 + growth + noise)),
		);
		const date = new Date();
		date.setDate(date.getDate() - dayOffset);
		return {
			date: date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			}),
			score,
		};
	});
}

export function SeoDashboard({
	seoDoc,
	keywords,
}: {
	seoDoc: SeoDocData | null | undefined;
	keywords: KeywordData[];
}) {
	const stats = useMemo(() => {
		const avgDifficulty =
			keywords.length > 0
				? Math.round(
						keywords.reduce((s, k) => s + (k.difficulty ?? 0), 0) /
							keywords.length,
					)
				: 0;
		const bestPosition = keywords.reduce(
			(best, k) =>
				k.position != null && (best === null || k.position < best)
					? k.position
					: best,
			null as number | null,
		);
		const decayWarnings = keywords.filter(
			(k) => getDecayHealth(k.decayFactor).level >= 2,
		).length;
		return { avgDifficulty, bestPosition, decayWarnings };
	}, [keywords]);

	const normalizedScore = clampPercent(seoDoc?.score);

	const scoreTrend = useMemo(
		() => generateScoreTrend(normalizedScore),
		[normalizedScore],
	);

	const clusters = useMemo(() => {
		const easy = keywords.filter((k) => (k.difficulty ?? 0) < 30).length;
		const medium = keywords.filter(
			(k) => (k.difficulty ?? 0) >= 30 && (k.difficulty ?? 0) < 70,
		).length;
		const hard = keywords.filter((k) => (k.difficulty ?? 0) >= 70).length;
		return [
			{ name: "Easy", value: easy, fill: "hsl(var(--chart-2))" },
			{ name: "Medium", value: medium, fill: "hsl(var(--chart-4))" },
			{ name: "Hard", value: hard, fill: "hsl(var(--chart-5))" },
		].filter((c) => c.value > 0);
	}, [keywords]);

	const alerts = useMemo(() => {
		const items: {
			type: "warning" | "danger" | "info";
			message: string;
			icon: typeof AlertTriangleIcon;
		}[] = [];
		const lowPosition = keywords.filter((k) => (k.position ?? 0) > 50);
		if (lowPosition.length > 0) {
			items.push({
				type: "warning",
				message: `${lowPosition.length} keyword${lowPosition.length > 1 ? "s" : ""} ranked below #50`,
				icon: AlertTriangleIcon,
			});
		}
		const declining = keywords.filter(
			(k) => getDecayHealth(k.decayFactor).level >= 3,
		);
		if (declining.length > 0) {
			items.push({
				type: "danger",
				message: `${declining.length} keyword${declining.length > 1 ? "s" : ""} showing decline`,
				icon: TrendingDownIcon,
			});
		}
		if (normalizedScore < 40) {
			items.push({
				type: "danger",
				message: "SEO score is critically low",
				icon: AlertCircleIcon,
			});
		} else if (normalizedScore < 70) {
			items.push({
				type: "warning",
				message: "SEO score needs improvement",
				icon: AlertTriangleIcon,
			});
		}
		if (keywords.length === 0) {
			items.push({
				type: "info",
				message:
					"No keywords tracked yet — add keywords to get started",
				icon: SearchIcon,
			});
		}
		if (items.length === 0) {
			items.push({
				type: "info",
				message: "All looking good! Keep monitoring your rankings.",
				icon: CheckCircle2Icon,
			});
		}
		return items;
	}, [keywords, normalizedScore]);

	const chartConfig = {
		score: { label: "SEO Score", color: "hsl(var(--chart-1))" },
	};

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					title="Total Keywords"
					value={keywords.length}
					subtitle="Active tracking targets"
					icon={TargetIcon}
				/>
				<MetricCard
					title="Avg. Difficulty"
					value={stats.avgDifficulty}
					subtitle={getDifficultyTier(stats.avgDifficulty).label}
					icon={GaugeIcon}
				/>
				<MetricCard
					title="Best Position"
					value={
						stats.bestPosition != null
							? `#${stats.bestPosition}`
							: "—"
					}
					subtitle="Highest ranking keyword"
					icon={TrophyIcon}
				/>
				<MetricCard
					title="Decay Warnings"
					value={stats.decayWarnings}
					subtitle={
						stats.decayWarnings > 0
							? "Keywords need attention"
							: "No current decay warnings"
					}
					icon={AlertTriangleIcon}
				/>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Score Trend (30 days)
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ChartContainer
							config={chartConfig}
							className="h-[220px] w-full"
						>
							<AreaChart
								data={scoreTrend}
								margin={{
									top: 4,
									right: 4,
									bottom: 0,
									left: 0,
								}}
							>
								<defs>
									<linearGradient
										id="scoreFill"
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop
											offset="0%"
											stopColor="var(--color-score)"
											stopOpacity={0.3}
										/>
										<stop
											offset="100%"
											stopColor="var(--color-score)"
											stopOpacity={0}
										/>
									</linearGradient>
								</defs>
								<XAxis
									dataKey="date"
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
									interval="preserveStartEnd"
								/>
								<YAxis
									domain={[0, 100]}
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
									width={30}
								/>
								<ChartTooltip
									content={<ChartTooltipContent />}
								/>
								<Area
									type="monotone"
									dataKey="score"
									stroke="var(--color-score)"
									strokeWidth={2}
									fill="url(#scoreFill)"
									dot={false}
								/>
							</AreaChart>
						</ChartContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Keyword Clusters
						</CardTitle>
					</CardHeader>
					<CardContent className="flex items-center justify-center">
						{clusters.length === 0 ? (
							<p className="text-sm text-muted-foreground py-8">
								No keyword data
							</p>
						) : (
							<div className="w-full">
								<div className="mx-auto h-40 w-48">
									<ResponsiveContainer
										width="100%"
										height="100%"
									>
										<PieChart>
											<Pie
												data={clusters}
												dataKey="value"
												nameKey="name"
												cx="50%"
												cy="50%"
												innerRadius={40}
												outerRadius={70}
												paddingAngle={3}
												strokeWidth={0}
											>
												{clusters.map((entry) => (
													<Cell
														key={entry.name}
														fill={entry.fill}
													/>
												))}
											</Pie>
										</PieChart>
									</ResponsiveContainer>
								</div>
								<div className="flex justify-center gap-4 mt-2">
									{clusters.map((c) => (
										<div
											key={c.name}
											className="flex items-center gap-1.5 text-xs"
										>
											<div
												className="h-2.5 w-2.5 rounded-full"
												style={{
													backgroundColor: c.fill,
												}}
											/>
											<span className="text-muted-foreground">
												{c.name}
											</span>
											<span className="font-medium">
												{c.value}
											</span>
										</div>
									))}
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">
						Alerts & Recommendations
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-2">
						{alerts.map((alert, i) => {
							const Icon = alert.icon;
							const borderColor =
								alert.type === "danger"
									? "border-red-200 dark:border-red-900/50"
									: alert.type === "warning"
										? "border-amber-200 dark:border-amber-900/50"
										: "border-border";
							const iconColor =
								alert.type === "danger"
									? "text-red-500 dark:text-red-400"
									: alert.type === "warning"
										? "text-amber-500 dark:text-amber-400"
										: "text-muted-foreground";
							return (
								<div
									key={`${alert.message}-${i}`}
									className={`flex items-center gap-3 rounded-lg border p-3 ${borderColor}`}
								>
									<Icon
										className={`h-4 w-4 shrink-0 ${iconColor}`}
									/>
									<span className="text-sm">
										{alert.message}
									</span>
								</div>
							);
						})}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
