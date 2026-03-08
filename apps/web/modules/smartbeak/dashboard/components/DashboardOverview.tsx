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
import { ActivityIcon, GlobeIcon, TrendingUpIcon, ZapIcon } from "lucide-react";
import Link from "next/link";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
	CardGridSkeleton,
	TableSkeleton,
} from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";

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

	const isError =
		domainsQuery.isError || portfolioQuery.isError || billingQuery.isError;

	const refetchAll = () => {
		domainsQuery.refetch();
		portfolioQuery.refetch();
		billingQuery.refetch();
	};

	const summary = portfolioQuery.data?.summary;
	const portfolioScore = Number(portfolioQuery.data?.portfolioScore ?? 0);
	const subscription = billingQuery.data?.subscription;

	return (
		<ErrorBoundary>
			<div className="space-y-8">
				{/* Metric Cards */}
				{isError ? (
					<div className="flex flex-col items-center py-8 text-center">
						<p className="text-sm text-destructive">
							Failed to load dashboard data.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={refetchAll}
						>
							Retry
						</Button>
					</div>
				) : isLoading ? (
					<CardGridSkeleton count={4} />
				) : (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<MetricCard
							title="Total Domains"
							value={
								(summary?.totalDomains ??
									domainsQuery.data?.total) ||
								0
							}
							subtitle="Managed properties"
							icon={GlobeIcon}
							trend={{ value: 12, label: "vs last month" }}
						/>
						<MetricCard
							title="Portfolio Score"
							value={portfolioScore.toFixed(1)}
							subtitle="Aggregate risk-adjusted score"
							icon={TrendingUpIcon}
							trend={{ value: 8.4, label: "vs last quarter" }}
						/>
						<MetricCard
							title="Avg. ROI"
							value={
								summary?.avgRoi != null
									? `${summary.avgRoi}%`
									: "—"
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
							<div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
								<p className="max-w-sm text-sm text-muted-foreground">
									Live publishing charts are not available in the
									overview yet. Open the publishing suite for current job
									status, queue state, and platform activity.
								</p>
								<Button variant="outline" size="sm" asChild>
									<Link
										href={`/app/${organizationSlug}/publishing-suite`}
									>
										Open Publishing Suite
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-medium">
								Traffic Overview
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
								<p className="max-w-sm text-sm text-muted-foreground">
									This overview no longer shows synthetic traffic data.
									Use the analytics area and domain-level reports to review
									recorded portfolio and buyer activity.
								</p>
								<Button variant="outline" size="sm" asChild>
									<Link href={`/app/${organizationSlug}/analytics`}>
										Open Analytics
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Recent Domains */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="text-sm font-medium">
							Recent Domains
						</CardTitle>
						<Button variant="ghost" size="sm" asChild>
							<Link href={`/app/${organizationSlug}/domains`}>
								View all
							</Link>
						</Button>
					</CardHeader>
					<CardContent>
						{domainsQuery.isLoading ? (
							<TableSkeleton rows={3} />
						) : (domainsQuery.data?.items ?? []).length === 0 ? (
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
								{(domainsQuery.data?.items ?? []).map(
									(domain) => (
										<div
											key={domain.id}
											className="flex items-center justify-between py-3"
										>
											<div className="flex items-center gap-3">
												<div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
													<GlobeIcon className="h-4 w-4 text-primary" />
												</div>
												<div>
													<p className="text-sm font-medium">
														{domain.name}
													</p>
													<p className="text-xs text-muted-foreground">
														{domain.slug}
													</p>
												</div>
											</div>
											<div className="flex items-center gap-3">
												<StatusBadge
													status={
														domain.status ??
														"pending"
													}
												/>
												<Button
													variant="ghost"
													size="sm"
													asChild
												>
													<Link
														href={`/app/${organizationSlug}/domains/${domain.id}/content`}
													>
														Open
													</Link>
												</Button>
											</div>
										</div>
									),
								)}
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
							Deploy supported site themes when SmartDeploy is
							configured for your workspace. Open the deployment
							area to select a domain and review current status.
						</p>
						<Button className="mt-4" asChild>
							<Link
								href={`/app/${organizationSlug}/smart-deploy`}
							>
								Deploy Site
							</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</ErrorBoundary>
	);
}
