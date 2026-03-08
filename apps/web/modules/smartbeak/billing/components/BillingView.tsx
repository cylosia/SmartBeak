"use client";
import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
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
import { format, formatDistanceToNow } from "date-fns";
import {
	BarChart2Icon,
	CalendarIcon,
	CreditCardIcon,
	ZapIcon,
} from "lucide-react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
	CardGridSkeleton,
	TableSkeleton,
} from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";

const DEFAULT_LIMITS: Record<string, number> = {
	domains: 10,
	content_items: 500,
	media_storage_gb: 10,
	ai_ideas: 100,
	publishing_jobs: 200,
};

const METRIC_LABELS: Record<string, string> = {
	domains: "Domains",
	content_items: "Content Items",
	media_storage_gb: "Media Storage (GB)",
	ai_ideas: "AI Ideas / month",
	publishing_jobs: "Publishing Jobs",
};

function parseValidDate(value: unknown) {
	if (typeof value !== "string" && !(value instanceof Date)) {
		return null;
	}

	const parsed = value instanceof Date ? value : new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCalendarDate(value: unknown) {
	const parsed = parseValidDate(value);
	return parsed ? format(parsed, "MMM d, yyyy") : null;
}

function formatRelativeDate(value: unknown) {
	const parsed = parseValidDate(value);
	return parsed ? formatDistanceToNow(parsed, { addSuffix: true }) : null;
}

export function BillingView({
	organizationSlug,
}: {
	organizationSlug: string;
}) {
	const billingQuery = useQuery(
		orpc.smartbeak.billing.get.queryOptions({
			input: { organizationSlug },
		}),
	);

	const subscription = billingQuery.data?.subscription;
	const invoices = billingQuery.data?.invoices ?? [];
	const usageRecords = billingQuery.data?.usageRecords ?? [];

	const usageQuotas = Object.entries(DEFAULT_LIMITS).map(
		([metric, limit]) => {
			const record = usageRecords.find((r) => r.metric === metric);
			return {
				label: METRIC_LABELS[metric] ?? metric,
				used: record ? Number(record.value) : 0,
				limit,
			};
		},
	);

	return (
		<ErrorBoundary>
			<div className="space-y-8">
				{/* Plan Cards */}
				{billingQuery.isError ? (
					<div className="flex flex-col items-center py-8 text-center">
						<p className="text-sm text-destructive">
							Failed to load billing data.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={() => billingQuery.refetch()}
						>
							Retry
						</Button>
					</div>
				) : billingQuery.isLoading ? (
					<CardGridSkeleton count={3} />
				) : (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<MetricCard
							title="Current Plan"
							value={subscription?.plan ?? "Free"}
							subtitle={`Status: ${subscription?.status ?? "inactive"}`}
							icon={ZapIcon}
						/>
						<MetricCard
							title="Billing Period"
							value={
								subscription?.currentPeriodEnd
									? formatCalendarDate(
											subscription.currentPeriodEnd,
										) ?? "—"
									: "—"
							}
							subtitle={
								subscription?.currentPeriodEnd
									? `Renews ${formatRelativeDate(subscription.currentPeriodEnd) ?? "soon"}`
									: "No active subscription"
							}
							icon={CalendarIcon}
						/>
						<MetricCard
							title="Invoices"
							value={invoices.length}
							subtitle={
								invoices.length > 0
									? `Latest: ${invoices[0]?.status ?? "—"}`
									: "No invoices yet"
							}
							icon={CreditCardIcon}
						/>
					</div>
				)}

				{/* Usage Quotas */}
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium flex items-center gap-2">
							<BarChart2Icon className="h-4 w-4" />
							Usage Quotas
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{usageQuotas.map((quota) => {
							const ratio =
								quota.limit > 0
									? Math.min(
											1,
											Math.max(0, quota.used / quota.limit),
										)
									: 0;
							return (
								<div key={quota.label}>
									<div className="flex items-center justify-between mb-1">
										<span className="text-sm font-medium">
											{quota.label}
										</span>
										<span className="text-sm text-muted-foreground">
											{quota.used} / {quota.limit}
										</span>
									</div>
									<Progress
										value={ratio * 100}
										className={`h-2 ${
											ratio > 0.95
												? "[&>div]:bg-red-500 dark:[&>div]:bg-red-400"
												: ratio > 0.8
													? "[&>div]:bg-amber-500 dark:[&>div]:bg-amber-400"
													: ""
										}`}
									/>
								</div>
							);
						})}
					</CardContent>
				</Card>

				{/* Invoices */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="text-sm font-medium">
							Recent Invoices
						</CardTitle>
						<Button variant="outline" size="sm" asChild>
							<a
								href={`/app/${organizationSlug}/settings/billing`}
							>
								<CreditCardIcon className="mr-2 h-4 w-4" />
								Manage Billing
							</a>
						</Button>
					</CardHeader>
					<CardContent>
						{billingQuery.isLoading ? (
							<TableSkeleton rows={3} />
						) : invoices.length === 0 ? (
							<p className="text-sm text-muted-foreground py-4 text-center">
								No invoices yet.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Invoice</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Date</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{invoices.map((inv) => (
										<TableRow key={inv.id}>
											<TableCell className="font-mono text-sm">
												{inv.stripeInvoiceId ??
													inv.id.slice(0, 8)}
											</TableCell>
											<TableCell>
												$
												{(
													(Number(inv.amountCents) ||
														0) / 100
												).toFixed(2)}
											</TableCell>
											<TableCell>
												<StatusBadge
													status={
														inv.status ?? "pending"
													}
												/>
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{formatCalendarDate(
													inv.createdAt,
												) ?? "—"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>
		</ErrorBoundary>
	);
}
