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
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangleIcon,
	CheckCircleIcon,
	InfoIcon,
	TrendingUpIcon,
} from "lucide-react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

const PRIORITY_CONFIG = {
	high: {
		icon: AlertTriangleIcon,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-500/10 border-red-500/20",
		label: "High Priority",
	},
	medium: {
		icon: InfoIcon,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-500/10 border-amber-500/20",
		label: "Medium Priority",
	},
	low: {
		icon: CheckCircleIcon,
		color: "text-blue-600 dark:text-blue-400",
		bg: "bg-blue-500/10 border-blue-500/20",
		label: "Low Priority",
	},
};

function ScoreRing({ score }: { score: number }) {
	const radius = 54;
	const circumference = 2 * Math.PI * radius;
	const dashOffset = circumference - (score / 100) * circumference;
	const strokeColor =
		score >= 80
			? "hsl(var(--chart-1))"
			: score >= 60
				? "hsl(var(--chart-3))"
				: score >= 40
					? "hsl(var(--chart-3))"
					: "hsl(var(--chart-5))";
	const textClass =
		score >= 80
			? "text-green-600 dark:text-green-400"
			: score >= 60
				? "text-amber-600 dark:text-amber-400"
				: score >= 40
					? "text-orange-600 dark:text-orange-400"
					: "text-red-600 dark:text-red-400";

	return (
		<div className="relative flex h-36 w-36 items-center justify-center">
			<svg
				className="absolute -rotate-90"
				width="144"
				height="144"
				aria-hidden="true"
			>
				<title>Score ring</title>
				<circle
					cx="72"
					cy="72"
					r={radius}
					fill="none"
					stroke="hsl(var(--border))"
					strokeWidth="10"
				/>
				<circle
					cx="72"
					cy="72"
					r={radius}
					fill="none"
					stroke={strokeColor}
					strokeWidth="10"
					strokeDasharray={circumference}
					strokeDashoffset={dashOffset}
					strokeLinecap="round"
					style={{ transition: "stroke-dashoffset 0.8s ease" }}
				/>
			</svg>
			<div className="text-center">
				<div className={`text-3xl font-bold ${textClass}`}>{score}</div>
				<div className="text-xs text-muted-foreground">/ 100</div>
			</div>
		</div>
	);
}

export function SellReadyPanel({
	organizationSlug,
	domainId,
	domainName,
}: {
	organizationSlug: string;
	domainId: string;
	domainName?: string;
}) {
	const query = useQuery(
		orpc.smartbeak.analyticsRoi.getSellReadyScore.queryOptions({
			input: { organizationSlug, domainId },
		}),
	);

	if (query.isLoading) {
		return <CardGridSkeleton count={3} />;
	}
	if (query.isError) {
		return (
			<div className="flex flex-col items-center py-8 text-center">
				<p className="text-sm text-destructive">
					Failed to load sell-ready score.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() => query.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const data = query.data;
	if (!data) {
		return null;
	}

	const readinessLabel =
		data.score >= 80
			? "Sell-Ready"
			: data.score >= 60
				? "Nearly Ready"
				: data.score >= 40
					? "Needs Work"
					: "Not Ready";

	const readinessColor =
		data.score >= 80
			? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20"
			: data.score >= 60
				? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20"
				: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20";

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Score Card */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="text-base">
									Sell-Ready Score
								</CardTitle>
								<CardDescription>
									{domainName ?? domainId}
								</CardDescription>
							</div>
							<Badge className={`border ${readinessColor}`}>
								<TrendingUpIcon className="mr-1.5 h-3 w-3" />
								{readinessLabel}
							</Badge>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col items-center gap-6 sm:flex-row">
							<ScoreRing score={data.score} />
							<div className="flex-1 space-y-3">
								{Object.entries(data.breakdown ?? {}).map(
									([key, value]) => {
										const labels: Record<
											string,
											{ label: string; max: number }
										> = {
											health: {
												label: "Domain Health",
												max: 25,
											},
											diligence: {
												label: "Diligence Score",
												max: 30,
											},
											monetization: {
												label: "Monetization Stability",
												max: 20,
											},
											buyerInterest: {
												label: "Buyer Interest",
												max: 30,
											},
											timelineActivity: {
												label: "Timeline Activity",
												max: 20,
											},
										};
										const cfg = labels[key];
										if (!cfg) {
											return null;
										}
										return (
											<div key={key}>
												<div className="mb-1 flex items-center justify-between text-xs">
													<span className="text-muted-foreground">
														{cfg.label}
													</span>
													<span className="font-medium">
														{value} / {cfg.max}
													</span>
												</div>
												<Progress
													value={
														(value / cfg.max) * 100
													}
													className="h-1.5"
												/>
											</div>
										);
									},
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Recommendations */}
				{(data.recommendations ?? []).length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-semibold">
								Improvement Recommendations
							</CardTitle>
							<CardDescription>
								Address these items to increase your sell-ready
								score
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{(data.recommendations ?? []).map((rec, i) => {
								const cfg =
									PRIORITY_CONFIG[
										rec.priority as keyof typeof PRIORITY_CONFIG
									] ?? PRIORITY_CONFIG.low;
								const Icon = cfg.icon;
								return (
									<div
										key={`rec-${rec.priority}-${i}`}
										className={`flex items-start gap-3 rounded-lg border p-3 ${cfg.bg}`}
									>
										<Icon
											className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`}
										/>
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<span
													className={`text-xs font-semibold ${cfg.color}`}
												>
													{rec.area}
												</span>
												<Badge
													className={`text-[10px] ${cfg.bg} ${cfg.color} border-current`}
												>
													{cfg.label}
												</Badge>
											</div>
											<p className="mt-0.5 text-sm text-foreground/80">
												{rec.message}
											</p>
										</div>
									</div>
								);
							})}
						</CardContent>
					</Card>
				)}

				{(data.recommendations ?? []).length === 0 && (
					<Card className="border-green-500/20 bg-green-500/5">
						<CardContent className="flex items-center gap-3 py-4">
							<CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
							<p className="text-sm font-medium text-green-700 dark:text-green-300">
								This domain meets all sell-ready criteria. It is
								ready to list.
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</ErrorBoundary>
	);
}
