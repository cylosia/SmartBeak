"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Progress } from "@repo/ui/components/progress";
import { Separator } from "@repo/ui/components/separator";
import { Switch } from "@repo/ui/components/switch";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
	AlertTriangleIcon,
	ArrowUpCircleIcon,
	CheckCircle2Icon,
	CreditCardIcon,
	InfinityIcon,
	UsersIcon,
	ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { EnterpriseBadge } from "@/modules/smartbeak/enterprise/shared/components/EnterpriseBadge";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton as LoadingSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

const FEATURE_LABELS: Record<string, string> = {
	sso: "SSO Configuration",
	scim: "SCIM Tokens",
	advancedAudit: "Advanced Audit Log",
	customRoles: "Custom Roles",
	prioritySupport: "Support Priority Flag",
	sla: "Custom Service Terms",
	dedicatedCsm: "Assigned Account Contact",
	customContracts: "Custom Contracts",
};

interface EnterpriseBillingDashboardProps {
	organizationSlug: string;
}

function formatCalendarDate(value: unknown) {
	if (typeof value !== "string" && !(value instanceof Date)) {
		return null;
	}

	const parsed = value instanceof Date ? value : new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : format(parsed, "MMM d, yyyy");
}

export function EnterpriseBillingDashboard({
	organizationSlug,
}: EnterpriseBillingDashboardProps) {
	const queryClient = useQueryClient();
	const [changePlanOpen, setChangePlanOpen] = useState(false);
	const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
	const [seats, setSeats] = useState(1);
	const [overageEnabled, setOverageEnabled] = useState(false);
	const [updateSeatsOpen, setUpdateSeatsOpen] = useState(false);
	const [newSeats, setNewSeats] = useState(1);

	const tiersQuery = useQuery(
		orpc.enterprise.billing.tiers.queryOptions({ input: {} }),
	);

	const orgTierQuery = useQuery(
		orpc.enterprise.billing.orgTier.get.queryOptions({
			input: { organizationSlug },
		}),
	);

	const usageQuery = useQuery(
		orpc.enterprise.billing.usage.queryOptions({
			input: { organizationSlug },
		}),
	);

	const setTierMutation = useMutation(
		orpc.enterprise.billing.orgTier.set.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.enterprise.billing.orgTier.get.key({
						input: { organizationSlug },
					}),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.enterprise.billing.usage.key({
						input: { organizationSlug },
					}),
				});
				setChangePlanOpen(false);
				toastSuccess("Billing tier settings saved.");
			},
			onError: (err) =>
				toastError(
					"Error",
					err instanceof Error
						? err.message
						: "An unexpected error occurred",
				),
		}),
	);

	const updateSeatsMutation = useMutation(
		orpc.enterprise.billing.seats.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.enterprise.billing.orgTier.get.key({
						input: { organizationSlug },
					}),
				});
				setUpdateSeatsOpen(false);
				toastSuccess("Seat settings saved.");
			},
			onError: (err) =>
				toastError(
					"Error",
					err instanceof Error
						? err.message
						: "An unexpected error occurred",
				),
		}),
	);

	const currentTier = orgTierQuery.data?.orgTier?.tier;
	const currentSeats = orgTierQuery.data?.orgTier?.seats ?? 1;
	const features = currentTier?.features as
		| Record<string, boolean>
		| undefined;
	const overageItems = (usageQuery.data?.usageWithLimits ?? []).filter(
		(u) => u.isOverage,
	);
	const nearLimitItems = (usageQuery.data?.usageWithLimits ?? []).filter(
		(u) => u.isNearLimit,
	);
	const orgTierState = orgTierQuery.data?.orgTier as
		| { overageEnabled?: boolean }
		| undefined;

	const handleChangePlanOpenChange = (open: boolean) => {
		setChangePlanOpen(open);
		if (open) {
			setSelectedTierId(currentTier?.id ?? null);
			setSeats(currentSeats);
			setOverageEnabled(orgTierState?.overageEnabled ?? false);
			return;
		}
		setSelectedTierId(null);
		setSeats(1);
		setOverageEnabled(false);
	};

	return (
		<ErrorBoundary>
			<div className="space-y-6">
				{/* Overage Alerts */}
				{overageItems.length > 0 && (
					<Alert className="border-red-200 bg-red-50 dark:bg-red-950/20">
						<AlertTriangleIcon className="size-4 text-red-600 dark:text-red-400" />
						<AlertDescription>
							<p className="font-semibold text-sm text-red-800 dark:text-red-200">
								Usage limit exceeded
							</p>
							<p className="text-xs text-red-700 dark:text-red-300 mt-1">
								{overageItems.map((i) => i.label).join(", ")}{" "}
								exceeded the configured tier limits. Review
								your plan settings or overage preferences.
							</p>
						</AlertDescription>
					</Alert>
				)}

				{nearLimitItems.length > 0 && overageItems.length === 0 && (
					<Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
						<AlertTriangleIcon className="size-4 text-yellow-600 dark:text-yellow-400" />
						<AlertDescription>
							<p className="text-sm text-yellow-800 dark:text-yellow-200">
								You are approaching your plan limits for:{" "}
								<strong>
									{nearLimitItems
										.map((i) => i.label)
										.join(", ")}
								</strong>
								.
							</p>
						</AlertDescription>
					</Alert>
				)}

				{/* Current Plan */}
				<Card>
					<CardHeader>
						<div className="flex items-start justify-between">
							<div className="flex items-center gap-3">
								<div className="flex size-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/50">
									<CreditCardIcon className="size-5 text-blue-600 dark:text-blue-400" />
								</div>
								<div>
									<CardTitle>Current Plan</CardTitle>
									<CardDescription>
										Your organization's configured billing tier
										and seat allocation.
									</CardDescription>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Dialog
									open={updateSeatsOpen}
									onOpenChange={setUpdateSeatsOpen}
								>
									<DialogTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											className="gap-2"
											onClick={() =>
												setNewSeats(currentSeats)
											}
										>
											<UsersIcon className="size-3.5" />
											Manage Seats
										</Button>
									</DialogTrigger>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>
												Update Seat Count
											</DialogTitle>
											<DialogDescription>
												Adjust the configured seat count
												for your organization.
											</DialogDescription>
										</DialogHeader>
										<div className="space-y-4">
											<div className="space-y-2">
												<Label>Number of Seats</Label>
												<Input
													type="number"
													min={1}
													value={newSeats}
													onChange={(e) =>
														setNewSeats(
															Math.max(
																1,
																Number(
																	e.target
																		.value,
																) || 1,
															),
														)
													}
												/>
												{currentTier && (
													<p className="text-xs text-muted-foreground">
														Cost:{" "}
														<strong>
															$
															{(
																(currentTier.pricePerSeatCents *
																	newSeats) /
																100
															).toFixed(2)}
															/
															{
																currentTier.interval
															}
														</strong>
													</p>
												)}
											</div>
										</div>
										<DialogFooter>
											<Button
												variant="outline"
												onClick={() =>
													setUpdateSeatsOpen(false)
												}
											>
												Cancel
											</Button>
											<Button
												disabled={
													updateSeatsMutation.isPending ||
													newSeats < 1
												}
												onClick={() =>
													updateSeatsMutation.mutate({
														organizationSlug,
														seats: newSeats,
													})
												}
											>
												{updateSeatsMutation.isPending
													? "Updating…"
													: "Update Seats"}
											</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
								<Button
									size="sm"
									className="gap-2"
									onClick={() => setChangePlanOpen(true)}
								>
									<ArrowUpCircleIcon className="size-3.5" />
									Change Plan
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{orgTierQuery.isLoading ? (
							<LoadingSkeleton rows={3} />
						) : orgTierQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<p className="text-sm text-destructive">
									Failed to load plan details
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => orgTierQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : !currentTier ? (
							<div className="flex flex-col items-center gap-3 py-8 text-center">
								<CreditCardIcon className="size-10 text-muted-foreground" />
								<div>
									<p className="font-medium text-sm">
										No plan configured
									</p>
									<p className="text-xs text-muted-foreground mt-1">
										Select a billing tier to get started.
									</p>
								</div>
								<Button
									size="sm"
									onClick={() => setChangePlanOpen(true)}
								>
									Choose a Plan
								</Button>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground uppercase tracking-wide">
										Plan
									</p>
									<div className="flex items-center gap-2">
										<p className="text-xl font-bold">
											{currentTier.displayName}
										</p>
										{currentTier.name === "enterprise" && (
											<EnterpriseBadge />
										)}
									</div>
									{currentTier.pricePerSeatCents > 0 ? (
										<p className="text-sm text-muted-foreground">
											$
											{(
												currentTier.pricePerSeatCents /
												100
											).toFixed(0)}
											/seat/
											{currentTier.interval}
										</p>
									) : (
										<p className="text-sm text-muted-foreground">
											Free
										</p>
									)}
								</div>
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground uppercase tracking-wide">
										Seats
									</p>
									<p className="text-xl font-bold">
										{currentSeats}
									</p>
									<p className="text-sm text-muted-foreground">
										{currentTier.pricePerSeatCents > 0
											? `$${((currentTier.pricePerSeatCents * currentSeats) / 100).toFixed(2)}/${currentTier.interval}`
											: "Included"}
									</p>
								</div>
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground uppercase tracking-wide">
										Period End
									</p>
									<p className="text-xl font-bold">
										{formatCalendarDate(
											orgTierQuery.data?.orgTier?.periodEnd,
										) ?? "—"}
									</p>
								</div>
							</div>
						)}

						{/* Feature flags */}
						{features && (
							<>
								<Separator className="my-4" />
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
									{Object.entries(FEATURE_LABELS).map(
										([key, label]) => (
											<div
												key={key}
												className="flex items-center gap-2"
											>
												{features[key] ? (
													<CheckCircle2Icon className="size-4 text-green-500 dark:text-green-400 shrink-0" />
												) : (
													<div className="size-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
												)}
												<span
													className={`text-xs ${features[key] ? "text-foreground" : "text-muted-foreground"}`}
												>
													{label}
												</span>
											</div>
										),
									)}
								</div>
							</>
						)}
					</CardContent>
				</Card>

				{/* Usage Metrics */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex size-9 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950/50">
								<ZapIcon className="size-5 text-green-600 dark:text-green-400" />
							</div>
							<div>
								<CardTitle>Usage</CardTitle>
								<CardDescription>
									Current recorded usage against configured tier limits.
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{usageQuery.isLoading ? (
							<LoadingSkeleton rows={6} />
						) : usageQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<p className="text-sm text-destructive">
									Failed to load usage
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => usageQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : (
							<div className="space-y-4">
								{(usageQuery.data?.usageWithLimits ?? []).map(
									(item) => (
										<div
											key={item.metric}
											className="space-y-1.5"
										>
											<div className="flex items-center justify-between text-sm">
												<span className="font-medium">
													{item.label}
												</span>
												<span className="text-muted-foreground">
													{item.unlimited ? (
														<span className="flex items-center gap-1">
															<InfinityIcon className="size-3.5" />
															Unlimited
														</span>
													) : (
														<>
															{item.used.toLocaleString()}{" "}
															/{" "}
															{item.limit.toLocaleString()}
															{item.isOverage && (
																<Badge
																	status="error"
																	className="ml-2 text-xs"
																>
																	Over limit
																</Badge>
															)}
														</>
													)}
												</span>
											</div>
											{!item.unlimited && (
												<Progress
													value={Math.min(
														item.percentUsed,
														100,
													)}
													className={`h-1.5 ${
														item.isOverage
															? "[&>div]:bg-destructive"
															: item.isNearLimit
																? "[&>div]:bg-yellow-500 dark:[&>div]:bg-yellow-400"
																: ""
													}`}
												/>
											)}
										</div>
									),
								)}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Change Plan Dialog */}
				<Dialog
					open={changePlanOpen}
					onOpenChange={handleChangePlanOpenChange}
				>
					<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Choose a Plan</DialogTitle>
							<DialogDescription>
								Select the plan that best fits your
								organization's needs.
							</DialogDescription>
						</DialogHeader>

						{tiersQuery.isLoading ? (
							<LoadingSkeleton rows={3} />
						) : tiersQuery.isError ? (
							<div className="flex flex-col items-center justify-center py-8 gap-3">
								<AlertTriangleIcon className="size-8 text-destructive opacity-60" />
								<div className="text-center">
									<p className="font-medium text-destructive text-sm">
										Failed to load plans
									</p>
									<p className="text-xs text-muted-foreground mt-1">
										{tiersQuery.error?.message ??
											"An unexpected error occurred."}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => tiersQuery.refetch()}
								>
									Try Again
								</Button>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
								{(tiersQuery.data?.tiers ?? []).map((tier) => {
									const tierFeatures =
										tier.features as Record<
											string,
											boolean
										>;
									const _tierLimits = tier.limits as Record<
										string,
										number
									>;
									const isSelected =
										selectedTierId === tier.id;
									const isCurrent =
										currentTier?.id === tier.id;

									return (
										<button
											type="button"
											key={tier.id}
											onClick={() => {
												setSelectedTierId(tier.id);
												setSeats(currentSeats);
											}}
											className={`rounded-xl border-2 p-4 text-left transition-all ${
												isSelected
													? "border-primary bg-primary/5"
													: "border-border hover:border-muted-foreground/40"
											}`}
										>
											<div className="flex items-center justify-between mb-2">
												<p className="font-bold">
													{tier.displayName}
												</p>
												{isCurrent && (
													<Badge
														status="success"
														className="text-xs"
													>
														Current
													</Badge>
												)}
												{tier.name === "enterprise" && (
													<EnterpriseBadge className="text-xs" />
												)}
											</div>
											<p className="text-xs text-muted-foreground mb-3">
												{tier.description}
											</p>
											<p className="text-lg font-bold">
												{tier.pricePerSeatCents === 0
													? "Free"
													: `$${(tier.pricePerSeatCents / 100).toFixed(0)}`}
												{tier.pricePerSeatCents > 0 && (
													<span className="text-xs font-normal text-muted-foreground">
														/seat/{tier.interval}
													</span>
												)}
											</p>
											<Separator className="my-3" />
											<ul className="space-y-1.5">
												{Object.entries(FEATURE_LABELS)
													.slice(0, 4)
													.map(([key, label]) => (
														<li
															key={key}
															className="flex items-center gap-2"
														>
															{tierFeatures[
																key
															] ? (
																<CheckCircle2Icon className="size-3.5 text-green-500 dark:text-green-400 shrink-0" />
															) : (
																<div className="size-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
															)}
															<span
																className={`text-xs ${tierFeatures[key] ? "" : "text-muted-foreground"}`}
															>
																{label}
															</span>
														</li>
													))}
											</ul>
										</button>
									);
								})}
							</div>
						)}

						{selectedTierId && (
							<div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
								<div className="space-y-2">
									<Label>Number of Seats</Label>
									<Input
										type="number"
										min={1}
										value={seats}
										onChange={(e) =>
											setSeats(
												Math.max(
													1,
													Number(e.target.value) || 1,
												),
											)
										}
									/>
								</div>
								<div className="flex items-center gap-3">
									<Switch
										checked={overageEnabled}
										onCheckedChange={setOverageEnabled}
									/>
									<div>
										<Label>Enable overage billing</Label>
										<p className="text-xs text-muted-foreground">
											Allow usage beyond limits with
											per-unit overage charges.
										</p>
									</div>
								</div>
							</div>
						)}

						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setChangePlanOpen(false)}
							>
								Cancel
							</Button>
							<Button
								disabled={
									!selectedTierId ||
									seats < 1 ||
									setTierMutation.isPending
								}
								onClick={() => {
									if (!selectedTierId) {
										return;
									}
									setTierMutation.mutate({
										organizationSlug,
										tierId: selectedTierId,
										seats,
										overageEnabled,
									});
								}}
							>
								{setTierMutation.isPending
									? "Updating…"
									: "Confirm Plan Change"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</ErrorBoundary>
	);
}
