"use client";

import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@repo/ui/components/select";
import { Switch } from "@repo/ui/components/switch";
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
import { format, formatDistanceToNow } from "date-fns";
import {
	AlertTriangleIcon,
	DownloadIcon,
	LockIcon,
	RefreshCwIcon,
	SearchIcon,
	SettingsIcon,
	ShieldIcon,
} from "lucide-react";
import { useState } from "react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton as LoadingSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

const ACTION_COLORS: Record<string, string> = {
	created:
		"bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
	updated: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
	deleted: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
	exported:
		"bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
	default: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function getActionColor(action: string): string {
	for (const [key, cls] of Object.entries(ACTION_COLORS)) {
		if (action.includes(key)) {
			return cls;
		}
	}
	return ACTION_COLORS.default ?? "text-gray-600 bg-gray-50";
}

const ENTITY_TYPES = [
	"domain",
	"content_item",
	"media_asset",
	"publishing_job",
	"organization_member",
	"enterprise_team",
	"enterprise_sso_provider",
	"enterprise_scim_token",
	"enterprise_audit_retention",
	"enterprise_org_tier",
	"audit_log",
];

interface EnterpriseAuditLogProps {
	organizationSlug: string;
}

export function EnterpriseAuditLog({
	organizationSlug,
}: EnterpriseAuditLogProps) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [entityType, setEntityType] = useState<string>("");
	const [action, setAction] = useState("");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [offset, setOffset] = useState(0);
	const limit = 50;

	const searchQuery = useQuery(
		orpc.enterprise.audit.search.queryOptions({
			input: {
				organizationSlug,
				query: search || undefined,
				entityType: entityType || undefined,
				action: action || undefined,
				startDate: startDate || undefined,
				endDate: endDate || undefined,
				limit,
				offset,
			},
		}),
	);

	const retentionQuery = useQuery(
		orpc.enterprise.audit.retention.get.queryOptions({
			input: { organizationSlug },
		}),
	);

	const [retentionDays, setRetentionDays] = useState<number>(90);
	const [exportEnabled, setExportEnabled] = useState(false);

	const setRetentionMutation = useMutation(
		orpc.enterprise.audit.retention.set.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.enterprise.audit.retention.get.key({
						input: { organizationSlug },
					}),
				});
				toastSuccess("Retention policy updated.");
			},
			onError: (err) => toastError("Error", err.message),
		}),
	);

	const exportMutation = useMutation(
		orpc.enterprise.audit.export.mutationOptions({
			onSuccess: (data) => {
				const blob = new Blob([data.data], {
					type:
						data.format === "csv" ? "text/csv" : "application/json",
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = data.filename;
				a.click();
				URL.revokeObjectURL(url);
				toastSuccess(`Exported ${data.count} audit events.`);
			},
			onError: (err) => toastError("Error", err.message),
		}),
	);

	const handleReset = () => {
		setSearch("");
		setEntityType("");
		setAction("");
		setStartDate("");
		setEndDate("");
		setOffset(0);
	};

	const totalPages = Math.ceil((searchQuery.data?.total ?? 0) / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="flex size-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
							<LockIcon className="size-5 text-slate-600 dark:text-slate-300" />
						</div>
						<div>
							<h2 className="text-lg font-semibold">
								Enterprise Audit Log
							</h2>
							<p className="text-sm text-muted-foreground">
								Immutable, SOC2-ready event trail for your
								organization.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => searchQuery.refetch()}
						>
							<RefreshCwIcon className="size-3.5" />
							Refresh
						</Button>
						<Popover>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									className="gap-2"
								>
									<DownloadIcon className="size-3.5" />
									Export
								</Button>
							</PopoverTrigger>
							<PopoverContent
								className="w-64 space-y-3"
								align="end"
							>
								<p className="text-sm font-semibold">
									Export Audit Log
								</p>
								<div className="space-y-2">
									<Button
										className="w-full"
										size="sm"
										variant="outline"
										disabled={exportMutation.isPending}
										onClick={() =>
											exportMutation.mutate({
												organizationSlug,
												format: "csv",
												startDate:
													startDate || undefined,
												endDate: endDate || undefined,
												entityType:
													entityType || undefined,
											})
										}
									>
										Export as CSV
									</Button>
									<Button
										className="w-full"
										size="sm"
										variant="outline"
										disabled={exportMutation.isPending}
										onClick={() =>
											exportMutation.mutate({
												organizationSlug,
												format: "json",
												startDate:
													startDate || undefined,
												endDate: endDate || undefined,
												entityType:
													entityType || undefined,
											})
										}
									>
										Export as JSON
									</Button>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</div>

				{/* Filters */}
				<Card>
					<CardContent className="pt-4">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<div className="relative">
								<SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Search actions…"
									className="pl-9"
									aria-label="Search"
									value={search}
									onChange={(e) => {
										setSearch(e.target.value);
										setOffset(0);
									}}
								/>
							</div>
							<Select
								value={entityType || "all"}
								onValueChange={(v) => {
									setEntityType(v === "all" ? "" : v);
									setOffset(0);
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="Entity type" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										All entity types
									</SelectItem>
									{ENTITY_TYPES.map((et) => (
										<SelectItem key={et} value={et}>
											{et.replace(/_/g, " ")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Input
								type="date"
								value={startDate ? startDate.split("T")[0] : ""}
								onChange={(e) => {
									setStartDate(
										e.target.value
											? `${e.target.value}T00:00:00.000Z`
											: "",
									);
									setOffset(0);
								}}
								placeholder="Start date"
							/>
							<Input
								type="date"
								value={endDate ? endDate.split("T")[0] : ""}
								onChange={(e) => {
									setEndDate(
										e.target.value
											? `${e.target.value}T23:59:59.999Z`
											: "",
									);
									setOffset(0);
								}}
								placeholder="End date"
							/>
						</div>
						{(search || entityType || startDate || endDate) && (
							<div className="mt-3 flex items-center gap-2">
								<p className="text-xs text-muted-foreground">
									Filters active
								</p>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 text-xs"
									onClick={handleReset}
								>
									Clear all
								</Button>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Results */}
				<Card>
					<CardHeader className="pb-2">
						<div className="flex items-center justify-between">
							<CardTitle className="text-sm font-semibold">
								Events
							</CardTitle>
							{searchQuery.data && (
								<p className="text-xs text-muted-foreground">
									{(
										searchQuery.data?.total ?? 0
									).toLocaleString()}{" "}
									total events
								</p>
							)}
						</div>
					</CardHeader>
					<CardContent className="p-0">
						{searchQuery.isLoading ? (
							<div className="p-6">
								<LoadingSkeleton rows={8} />
							</div>
						) : searchQuery.isError ? (
							<div className="flex flex-col items-center gap-2 py-10 text-center">
								<p className="text-sm text-destructive">
									Failed to load audit events.
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => searchQuery.refetch()}
								>
									Retry
								</Button>
							</div>
						) : (searchQuery.data?.items ?? []).length === 0 ? (
							<div className="flex flex-col items-center gap-2 py-10 text-center">
								<ShieldIcon className="size-8 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									No audit events match your filters.
								</p>
							</div>
						) : (
							<>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Action</TableHead>
											<TableHead>Entity</TableHead>
											<TableHead>Actor</TableHead>
											<TableHead>Details</TableHead>
											<TableHead className="whitespace-nowrap">
												Time
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(searchQuery.data?.items ?? []).map(
											(event) => (
												<TableRow key={event.id}>
													<TableCell>
														<span
															className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getActionColor(event.action ?? "")}`}
														>
															{event.action}
														</span>
													</TableCell>
													<TableCell>
														<div>
															<p className="text-sm font-medium capitalize">
																{event.entityType?.replace(
																	/_/g,
																	" ",
																) ?? "—"}
															</p>
															{event.entityId && (
																<p className="text-xs text-muted-foreground font-mono">
																	{event.entityId.slice(
																		0,
																		8,
																	)}
																	…
																</p>
															)}
														</div>
													</TableCell>
													<TableCell className="text-sm text-muted-foreground font-mono">
														{event.actorId
															? `${event.actorId.slice(0, 8)}…`
															: "system"}
													</TableCell>
													<TableCell>
														{event.details ? (
															<code className="text-xs bg-muted rounded px-1.5 py-0.5 max-w-xs truncate block">
																{JSON.stringify(
																	event.details,
																).slice(0, 60)}
															</code>
														) : (
															<span className="text-muted-foreground text-sm">
																—
															</span>
														)}
													</TableCell>
													<TableCell className="text-xs text-muted-foreground whitespace-nowrap">
														<span
															title={format(
																new Date(
																	event.createdAt,
																),
																"PPpp",
															)}
														>
															{formatDistanceToNow(
																new Date(
																	event.createdAt,
																),
																{
																	addSuffix: true,
																},
															)}
														</span>
													</TableCell>
												</TableRow>
											),
										)}
									</TableBody>
								</Table>

								{/* Pagination */}
								{totalPages > 1 && (
									<div className="flex items-center justify-between border-t px-6 py-3">
										<p className="text-xs text-muted-foreground">
											Page {currentPage} of {totalPages}
										</p>
										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={offset === 0}
												onClick={() =>
													setOffset(
														Math.max(
															0,
															offset - limit,
														),
													)
												}
											>
												Previous
											</Button>
											<Button
												variant="outline"
												size="sm"
												disabled={
													offset + limit >=
													(searchQuery.data?.total ??
														0)
												}
												onClick={() =>
													setOffset(offset + limit)
												}
											>
												Next
											</Button>
										</div>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>

				{/* Retention Policy */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex size-9 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950/50">
								<SettingsIcon className="size-5 text-orange-600" />
							</div>
							<div>
								<CardTitle>Retention Policy</CardTitle>
								<CardDescription>
									Configure how long audit events are
									retained. SOC2 recommends at least 365 days.
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{retentionQuery.isLoading ? (
							<LoadingSkeleton rows={2} />
						) : retentionQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<p className="text-sm text-destructive">
									Failed to load data
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => retentionQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : (
							<>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div className="space-y-2">
										<Label>Retention Period (days)</Label>
										<Select
											value={String(
												retentionQuery.data?.retention
													.retentionDays ?? 90,
											)}
											onValueChange={(v) =>
												setRetentionDays(Number(v))
											}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="30">
													30 days
												</SelectItem>
												<SelectItem value="90">
													90 days
												</SelectItem>
												<SelectItem value="180">
													180 days
												</SelectItem>
												<SelectItem value="365">
													1 year (SOC2 recommended)
												</SelectItem>
												<SelectItem value="730">
													2 years
												</SelectItem>
												<SelectItem value="2555">
													7 years (maximum)
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className="flex items-center gap-3 pt-6">
										<Switch
											checked={
												retentionQuery.data?.retention
													.exportEnabled ?? false
											}
											onCheckedChange={setExportEnabled}
										/>
										<Label>Enable scheduled exports</Label>
									</div>
								</div>
								<Button
									size="sm"
									disabled={setRetentionMutation.isPending}
									onClick={() =>
										setRetentionMutation.mutate({
											organizationSlug,
											retentionDays,
											exportEnabled,
										})
									}
								>
									{setRetentionMutation.isPending
										? "Saving…"
										: "Save Retention Policy"}
								</Button>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</ErrorBoundary>
	);
}
