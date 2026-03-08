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
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircleIcon,
	ClockIcon,
	PencilIcon,
	ShieldCheckIcon,
	XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

const STATUS_CONFIG = {
	passed: {
		icon: CheckCircleIcon,
		color: "text-green-600 dark:text-green-400",
		bg: "bg-green-500/10 border-green-500/20",
	},
	failed: {
		icon: XCircleIcon,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-500/10 border-red-500/20",
	},
	pending: {
		icon: ClockIcon,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-500/10 border-amber-500/20",
	},
	skipped: {
		icon: ClockIcon,
		color: "text-muted-foreground",
		bg: "bg-muted/50",
	},
};

const TYPE_LABELS: Record<string, string> = {
	ownership: "Ownership Verification",
	legal: "Legal & Compliance",
	financial: "Financial Health",
	traffic: "Traffic Quality",
	content: "Content Quality",
	technical: "Technical Audit",
	brand: "Brand Integrity",
	monetization: "Monetization Stability",
};

function clampPercent(value: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, value));
}

function formatCalendarDate(value: unknown) {
	if (typeof value !== "string" && !(value instanceof Date)) {
		return null;
	}

	const parsed = value instanceof Date ? value : new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

export function DiligenceEngineView({
	organizationSlug,
	domainId,
	domainName,
}: {
	organizationSlug: string;
	domainId: string;
	domainName?: string;
}) {
	const queryClient = useQueryClient();
	const [editingType, setEditingType] = useState<string | null>(null);

	const reportQuery = useQuery(
		orpc.smartbeak.analyticsRoi.getDiligenceReport.queryOptions({
			input: { organizationSlug, domainId },
		}),
	);

	const updateMutation = useMutation(
		orpc.smartbeak.analyticsRoi.updateDiligenceCheck.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: [
						"smartbeak",
						"analyticsRoi",
						"getDiligenceReport",
					],
				});
				setEditingType(null);
				toastSuccess("Check updated");
			},
			onError: (e: Error) => toastError("Update failed", e.message),
		}),
	);

	if (reportQuery.isLoading) {
		return <TableSkeleton rows={8} />;
	}
	if (reportQuery.isError) {
		return (
			<div className="flex flex-col items-center py-8 text-center">
				<p className="text-sm text-destructive">
					Failed to load diligence report.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() => reportQuery.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const report = reportQuery.data?.report;
	if (!report) {
		return null;
	}
	const existingChecks = report.checks ?? [];
	const checksByType = new Map(
		existingChecks.map((check) => [check.type, check] as const),
	);
	const checks = Object.keys(TYPE_LABELS).map(
		(type) =>
			checksByType.get(type) ?? {
				id: `manual-${type}`,
				type,
				status: "pending",
				completedAt: null,
				result: null,
			},
	);
	const reportScore = clampPercent(report.score);

	const scoreColor =
		reportScore >= 80
			? "text-green-600 dark:text-green-400"
			: reportScore >= 60
				? "text-amber-600 dark:text-amber-400"
				: "text-red-600 dark:text-red-400";

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Score Header */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
									<ShieldCheckIcon className="h-5 w-5 text-primary" />
								</div>
								<div>
									<CardTitle className="text-base">
										Diligence Report
									</CardTitle>
									<CardDescription>
										{domainName ?? domainId}
									</CardDescription>
								</div>
							</div>
							<Button
								size="sm"
								disabled
							>
								Unavailable
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
							Automated diligence is not available yet. Record
							manual review outcomes for each diligence category
							using the edit controls below.
						</div>
						<div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
							<div className="text-center">
								<div
									className={`text-3xl font-bold ${scoreColor}`}
								>
									{reportScore}%
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									Overall Score
								</div>
							</div>
							<div className="text-center">
								<div className="text-3xl font-bold text-green-600 dark:text-green-400">
									{report.passed}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									Passed
								</div>
							</div>
							<div className="text-center">
								<div className="text-3xl font-bold text-red-600 dark:text-red-400">
									{report.failed}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									Failed
								</div>
							</div>
							<div className="text-center">
								<div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
									{report.pending}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									Pending
								</div>
							</div>
						</div>
						<Progress value={reportScore} className="mt-4 h-2" />
					</CardContent>
				</Card>

				{/* Checks Table */}
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-semibold">
							Check Results
						</CardTitle>
						<CardDescription>
							Use the edit icon to record a manual review status for
							each diligence category.
						</CardDescription>
					</CardHeader>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Check Type</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Completed</TableHead>
									<TableHead>Notes</TableHead>
									<TableHead className="w-10" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{checks.map((check) => {
									const cfg =
										STATUS_CONFIG[
											check.status as keyof typeof STATUS_CONFIG
										] ?? STATUS_CONFIG.pending;
									const Icon = cfg.icon;
									return (
										<TableRow key={check.id}>
											<TableCell className="font-medium">
												{TYPE_LABELS[check.type] ??
													check.type}
											</TableCell>
											<TableCell>
												<Badge
													className={`gap-1.5 ${cfg.bg} ${cfg.color} border`}
												>
													<Icon className="h-3 w-3" />
													{check.status ?? "pending"}
												</Badge>
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{formatCalendarDate(
													check.completedAt,
												) ?? "—"}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{(check.result as Record<
													string,
													unknown
												> | null)?.manual
													? "Manually reviewed"
													: "Manual review required"}
											</TableCell>
											<TableCell>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7"
													aria-label="Edit check"
													onClick={() =>
														setEditingType(
															editingType ===
																check.type
																? null
																: check.type,
														)
													}
												>
													<PencilIcon className="h-3.5 w-3.5" />
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				{/* Inline Override Panel */}
				{editingType && (
					<Card className="border-primary/30 bg-primary/5">
						<CardHeader>
							<CardTitle className="text-sm">
								Override:{" "}
								{TYPE_LABELS[editingType] ?? editingType}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-2">
								{(
									[
										"passed",
										"failed",
										"pending",
										"skipped",
									] as const
								).map((s) => (
									<Button
										key={s}
										variant="outline"
										size="sm"
										disabled={updateMutation.isPending}
										onClick={() =>
											updateMutation.mutate({
												organizationSlug,
												domainId,
												type: editingType,
												status: s,
												result: {
													manual: true,
													overriddenBy: "user",
												},
											})
										}
									>
										Mark {s}
									</Button>
								))}
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setEditingType(null)}
								>
									Cancel
								</Button>
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</ErrorBoundary>
	);
}
