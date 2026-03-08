"use client";
import { Button } from "@repo/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/ui/components/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/tabs";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
	AlertTriangleIcon,
	RefreshCwIcon,
	RotateCcwIcon,
	WebhookIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

function parseValidDate(value: unknown) {
	if (typeof value !== "string" && !(value instanceof Date)) {
		return null;
	}
	const parsed = value instanceof Date ? value : new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeDate(value: unknown) {
	const parsed = parseValidDate(value);
	return parsed ? formatDistanceToNow(parsed, { addSuffix: true }) : null;
}

const UNSUPPORTED_TARGET_MESSAGES: Partial<Record<string, string>> = {
	web: "Use SmartDeploy directly instead of the publishing queue.",
	email:
		"Email publishing is unavailable because the queue does not safely model recipients or per-message content.",
	youtube:
		"YouTube publishing is unavailable because the queue cannot upload required video assets.",
	instagram:
		"Instagram publishing is unavailable because the queue cannot attach required media assets.",
	tiktok:
		"TikTok publishing is unavailable because the queue cannot attach required video assets.",
	vimeo:
		"Vimeo publishing is unavailable because the queue cannot attach required video assets.",
};

export function DLQView({ organizationSlug }: { organizationSlug: string }) {
	const queryClient = useQueryClient();
	const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(
		new Set(),
	);

	const dlqJobsQuery = useQuery(
		orpc.smartbeak.publishingSuite.dlq.listJobs.queryOptions({
			input: { organizationSlug, limit: 50, offset: 0 },
		}),
	);

	const dlqWebhooksQuery = useQuery(
		orpc.smartbeak.publishingSuite.dlq.listWebhooks.queryOptions({
			input: { organizationSlug, limit: 50, offset: 0 },
		}),
	);

	const retryJobMutation = useMutation(
		orpc.smartbeak.publishingSuite.dlq.retryJob.mutationOptions({
			onSuccess: () => {
				toastSuccess("Job re-queued", "Job moved back to pending.");
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite"],
				});
			},
			onError: (err: unknown) =>
				toastError(
					"Retry failed",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const bulkRetryMutation = useMutation(
		orpc.smartbeak.publishingSuite.dlq.bulkRetry.mutationOptions({
			onSuccess: (data) => {
				toastSuccess("Bulk retry", `${data.count} jobs re-queued.`);
				setSelectedJobIds(new Set());
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite"],
				});
			},
			onError: (err: unknown) =>
				toastError(
					"Bulk retry failed",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const replayWebhookMutation = useMutation(
		orpc.smartbeak.publishingSuite.dlq.replayWebhook.mutationOptions({
			onSuccess: () => {
				toastSuccess("Webhook replayed");
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite"],
				});
			},
			onError: (err: unknown) =>
				toastError(
					"Replay failed",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	useEffect(() => {
		const visibleJobIds = new Set(
			(dlqJobsQuery.data?.jobs ?? []).map((job: { id: string }) => job.id),
		);
		setSelectedJobIds((current) => {
			if (current.size === 0) {
				return current;
			}
			const next = new Set(
				Array.from(current).filter((id) => visibleJobIds.has(id)),
			);
			return next.size === current.size ? current : next;
		});
	}, [dlqJobsQuery.data?.jobs]);

	const toggleJobSelection = (id: string) => {
		setSelectedJobIds((s) => {
			const next = new Set(s);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	return (
		<ErrorBoundary>
			<div className="space-y-4">
				<div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
					<AlertTriangleIcon className="h-4 w-4 text-red-500 dark:text-red-400" />
					<p className="text-sm text-red-700 dark:text-red-400">
						Dead-Letter Queue — items here have exhausted all retry
						attempts. Review errors before re-queuing.
					</p>
				</div>

				<Tabs defaultValue="jobs">
					<TabsList>
						<TabsTrigger value="jobs" className="gap-1.5">
							<RefreshCwIcon className="h-3.5 w-3.5" />
							Failed Jobs
							{(dlqJobsQuery.data?.count ?? 0) > 0 && (
								<span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
									{dlqJobsQuery.data?.count}
								</span>
							)}
						</TabsTrigger>
						<TabsTrigger value="webhooks" className="gap-1.5">
							<WebhookIcon className="h-3.5 w-3.5" />
							Failed Webhooks
							{(dlqWebhooksQuery.data?.count ?? 0) > 0 && (
								<span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
									{dlqWebhooksQuery.data?.count}
								</span>
							)}
						</TabsTrigger>
					</TabsList>

					{/* Failed Jobs */}
					<TabsContent value="jobs" className="mt-4">
						{selectedJobIds.size > 0 && (
							<div className="mb-3 flex items-center gap-2">
								<span className="text-sm text-muted-foreground">
									{selectedJobIds.size} selected
								</span>
								<Button
									size="sm"
									variant="outline"
									className="h-7 gap-1 text-xs"
									disabled={bulkRetryMutation.isPending}
									onClick={() =>
										bulkRetryMutation.mutate({
											organizationSlug,
											jobIds: Array.from(selectedJobIds),
										})
									}
								>
									<RotateCcwIcon className="h-3 w-3" />
									Bulk Retry
								</Button>
							</div>
						)}

						{dlqJobsQuery.isLoading ? (
							<TableSkeleton rows={5} />
						) : dlqJobsQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<p className="text-sm text-destructive">
									Failed to load data
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => dlqJobsQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : !dlqJobsQuery.data?.jobs?.length ? (
							<EmptyState
								icon={RefreshCwIcon}
								title="No failed jobs recorded"
								description="No failed publishing jobs are currently listed in the dead-letter queue."
							/>
						) : (
							<div className="overflow-x-auto rounded-xl border border-border bg-card">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-8">
												<input
													type="checkbox"
													className="rounded"
													aria-label="Select all failed jobs"
													onChange={(e) => {
														if (e.target.checked) {
															setSelectedJobIds(
																new Set(
																	(
																		dlqJobsQuery
																			.data
																			?.jobs ??
																		[]
													)
														.filter(
															(j: {
																target: string;
															}) =>
																!UNSUPPORTED_TARGET_MESSAGES[
																	j.target
																],
														)
														.map(
																		(j: {
															id: string;
																		}) =>
															j.id,
																	),
																),
															);
														} else {
															setSelectedJobIds(
																new Set(),
															);
														}
													}}
												/>
											</TableHead>
											<TableHead>Platform</TableHead>
											<TableHead>Error</TableHead>
											<TableHead>Created</TableHead>
											<TableHead className="text-right">
												Actions
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(dlqJobsQuery.data?.jobs ?? []).map(
											(job: {
												id: string;
												target: string;
												error: string | null;
												createdAt: Date | string;
											}) => {
												const unsupportedMessage =
													UNSUPPORTED_TARGET_MESSAGES[
														job.target
													];
												return (
													<TableRow key={job.id}>
													<TableCell>
														<input
															type="checkbox"
															className="rounded"
															aria-label={`Select failed job ${job.target}`}
															checked={selectedJobIds.has(
																job.id,
															)}
															disabled={Boolean(
																unsupportedMessage,
															)}
															onChange={() =>
																toggleJobSelection(
																	job.id,
																)
															}
														/>
													</TableCell>
													<TableCell className="font-medium capitalize">
														{job.target}
													</TableCell>
													<TableCell className="max-w-[300px] truncate text-xs text-red-500 dark:text-red-400">
														{job.error ??
															unsupportedMessage ??
															"Unknown error"}
													</TableCell>
													<TableCell className="text-sm text-muted-foreground">
														{formatRelativeDate(
															job.createdAt,
														) ?? "—"}
													</TableCell>
													<TableCell className="text-right">
														<Button
															size="sm"
															variant="outline"
															className="h-7 gap-1 text-xs"
															disabled={
																Boolean(
																	unsupportedMessage,
																) ||
																retryJobMutation.isPending
															}
															onClick={() =>
																retryJobMutation.mutate(
																	{
																		organizationSlug,
																		jobId: job.id,
																	},
																)
															}
														>
															<RotateCcwIcon className="h-3 w-3" />
															{unsupportedMessage
																? "Unsupported"
																: "Retry"}
														</Button>
													</TableCell>
													</TableRow>
												);
											},
										)}
									</TableBody>
								</Table>
							</div>
						)}
					</TabsContent>

					{/* Failed Webhooks */}
					<TabsContent value="webhooks" className="mt-4">
						{dlqWebhooksQuery.isLoading ? (
							<TableSkeleton rows={4} />
						) : dlqWebhooksQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<p className="text-sm text-destructive">
									Failed to load data
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => dlqWebhooksQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : !dlqWebhooksQuery.data?.events?.length ? (
							<EmptyState
								icon={WebhookIcon}
								title="No failed webhooks recorded"
								description="No failed webhook events are currently listed in the dead-letter queue."
							/>
						) : (
							<div className="overflow-x-auto rounded-xl border border-border bg-card">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Provider</TableHead>
											<TableHead>Event Type</TableHead>
											<TableHead>Error</TableHead>
											<TableHead>Replays</TableHead>
											<TableHead>Created</TableHead>
											<TableHead className="text-right">
												Actions
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(
											dlqWebhooksQuery.data?.events ?? []
										).map(
											(event: {
												id: string;
												provider: string;
												eventType: string;
												error: string | null;
												replayCount: number | null;
												createdAt: Date | string;
											}) => (
												<TableRow key={event.id}>
													<TableCell className="font-medium capitalize">
														{event.provider}
													</TableCell>
													<TableCell className="text-sm">
														{event.eventType}
													</TableCell>
													<TableCell className="max-w-[200px] truncate text-xs text-red-500 dark:text-red-400">
														{event.error ?? "—"}
													</TableCell>
													<TableCell className="text-sm">
														{event.replayCount ?? 0}
													</TableCell>
													<TableCell className="text-sm text-muted-foreground">
														{formatRelativeDate(
															event.createdAt,
														) ?? "—"}
													</TableCell>
													<TableCell className="text-right">
														<Button
															size="sm"
															variant="outline"
															className="h-7 gap-1 text-xs"
															disabled={
																replayWebhookMutation.isPending
															}
															onClick={() =>
																replayWebhookMutation.mutate(
																	{
																		eventId:
																			event.id,
																	},
																)
															}
														>
															<RotateCcwIcon className="h-3 w-3" />
															Replay
														</Button>
													</TableCell>
												</TableRow>
											),
										)}
									</TableBody>
								</Table>
							</div>
						)}
					</TabsContent>
				</Tabs>
			</div>
		</ErrorBoundary>
	);
}
