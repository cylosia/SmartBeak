"use client";
import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import {
	AlertCircleIcon,
	CheckCircleIcon,
	ShieldCheckIcon,
	TrendingUpIcon,
	UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";

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
	const portfolioScore = Number(portfolioQuery.data?.portfolioScore ?? 0);

	return (
		<ErrorBoundary>
			<div className="space-y-8">
				{/* Metric Cards */}
				{portfolioQuery.isError ? (
					<div className="flex flex-col items-center py-8 text-center">
						<p className="text-sm text-destructive">
							Failed to load portfolio data.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={() => portfolioQuery.refetch()}
						>
							Retry
						</Button>
					</div>
				) : portfolioQuery.isLoading ? (
					<CardGridSkeleton count={4} />
				) : (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<MetricCard
							title="Portfolio Score"
							value={portfolioScore.toFixed(1)}
							subtitle="Aggregate risk-adjusted score"
							icon={TrendingUpIcon}
							trend={{ value: 12.4, label: "vs last quarter" }}
						/>
						<MetricCard
							title="Average ROI"
							value={
								summary?.avgRoi != null ? `${summary.avgRoi}%` : "—"
							}
							subtitle="Across all domains"
							icon={CheckCircleIcon}
							trend={{ value: 3.1, label: "vs last month" }}
						/>
						<MetricCard
							title="Total Domains"
							value={summary?.totalDomains ?? 0}
							subtitle="Active properties"
							icon={ShieldCheckIcon}
						/>
						<MetricCard
							title="Domain Analytics"
							value="Per Domain"
							subtitle="Diligence and sell-readiness data are domain-specific"
							icon={UsersIcon}
						/>
					</div>
				)}

				{/* Charts Row */}
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
					<Card className="lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-sm font-medium">
								Diligence Checks
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
								<p className="max-w-sm text-sm text-muted-foreground">
									Diligence results are generated per domain. Open a domain
									record to review ownership, legal, technical, and
									monetization checks with recorded manual review status.
								</p>
								<Button variant="outline" size="sm" asChild>
									<Link href={`/app/${organizationSlug}/domains`}>
										Choose a Domain
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card className="lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-sm font-medium">
								Buyer Attribution
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
								<p className="max-w-sm text-sm text-muted-foreground">
									Buyer attribution is based on recorded buyer sessions and
									captured buyer-email identification data. Open a domain
									analytics view to inspect intent breakdowns and trend
									history.
								</p>
								<Button variant="outline" size="sm" asChild>
									<Link href={`/app/${organizationSlug}/domains`}>
										Open Domain Analytics
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card className="lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-sm font-medium">
								Sell-Readiness Estimate
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
								<p className="max-w-sm text-sm text-muted-foreground">
									Readiness guidance depends on a specific domain's
									recorded health, diligence checks, timeline activity,
									and buyer-interest signals. Select a domain to see the
									estimate and recommendations.
								</p>
								<Button variant="outline" size="sm" asChild>
									<Link href={`/app/${organizationSlug}/domains`}>
										Review Domain Readiness
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</ErrorBoundary>
	);
}
