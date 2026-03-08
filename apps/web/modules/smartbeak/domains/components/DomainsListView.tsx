"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

function isSafeUrl(url: string | null | undefined): url is string {
	if (!url) {
		return false;
	}
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@repo/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input } from "@repo/ui/components/input";
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
import {
	ExternalLinkIcon,
	EyeIcon,
	GlobeIcon,
	Loader2Icon,
	MoreHorizontalIcon,
	PlusIcon,
	SettingsIcon,
	TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import z from "zod";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";

const CreateDomainSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(255),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(1, "Slug is required")
		.max(255)
		.regex(
			/^[a-z0-9-]+$/,
			"Slug must be lowercase alphanumeric with hyphens",
		),
});

type CreateDomainForm = z.infer<typeof CreateDomainSchema>;

export function DomainsListView({
	organizationSlug,
}: {
	organizationSlug: string;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);
	const queryClient = useQueryClient();

	const domainsQuery = useQuery(
		orpc.smartbeak.domains.list.queryOptions({
			input: {
				organizationSlug,
				query: deferredSearch.trim() || undefined,
				limit: 50,
				offset: 0,
			},
		}),
	);

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<CreateDomainForm>({
		resolver: zodResolver(CreateDomainSchema),
	});

	const createMutation = useMutation(
		orpc.smartbeak.domains.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.smartbeak.domains.list.key(),
				});
				toastSuccess("Domain created", "Your domain has been added.");
				reset();
				setOpen(false);
			},
			onError: (err) => {
				toastError("Error", err.message);
			},
		}),
	);

	const deleteMutation = useMutation(
		orpc.smartbeak.domains.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.smartbeak.domains.list.key(),
				});
				toastSuccess("Domain deleted");
			},
			onError: (err) => {
				toastError("Error", err.message);
			},
		}),
	);

	const onSubmit = (data: CreateDomainForm) => {
		createMutation.mutate({ organizationSlug, ...data });
	};

	return (
		<ErrorBoundary>
			<div className="space-y-4">
				{/* Toolbar */}
				<div className="flex items-center justify-between gap-4">
					<Input
						placeholder="Search domains..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="max-w-xs"
						aria-label="Search domains"
					/>
					<Button onClick={() => setOpen(true)}>
						<PlusIcon className="mr-2 h-4 w-4" />
						Add Domain
					</Button>
				</div>

				{/* Table */}
				{domainsQuery.isError ? (
					<div className="flex flex-col items-center py-8 text-center">
						<p className="text-sm text-destructive">
							Failed to load domains.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={() => domainsQuery.refetch()}
						>
							Retry
						</Button>
					</div>
				) : domainsQuery.isLoading ? (
					<TableSkeleton rows={5} />
				) : (domainsQuery.data?.items ?? []).length === 0 ? (
					<EmptyState
						icon={GlobeIcon}
						title="No domains yet"
						description="Add your first domain to start publishing content."
						action={
							<Button onClick={() => setOpen(true)}>
								<PlusIcon className="mr-2 h-4 w-4" />
								Add Domain
							</Button>
						}
					/>
				) : (
					<div className="rounded-xl border border-border overflow-hidden">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Domain</TableHead>
									<TableHead>Slug</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Deployed URL</TableHead>
									<TableHead className="text-right">
										Actions
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(domainsQuery.data?.items ?? []).map(
									(domain) => (
										<TableRow
											key={domain.id}
											className="group"
										>
											<TableCell>
												<Link
													href={`/app/${organizationSlug}/domains/${domain.id}`}
													className="flex items-center gap-3 hover:opacity-80 transition-opacity"
												>
													<div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
														<GlobeIcon className="h-4 w-4 text-primary" />
													</div>
													<span className="font-medium">
														{domain.name}
													</span>
												</Link>
											</TableCell>
											<TableCell className="text-muted-foreground font-mono text-sm">
												{domain.slug}
											</TableCell>
											<TableCell>
												<StatusBadge
													status={
														domain.status ??
														"pending"
													}
												/>
											</TableCell>
											<TableCell>
												{isSafeUrl(
													domain.deployedUrl,
												) ? (
													<a
														href={
															domain.deployedUrl
														}
														target="_blank"
														rel="noopener noreferrer"
														className="flex items-center gap-1 text-sm text-primary hover:underline"
													>
														{domain.deployedUrl}
														<ExternalLinkIcon className="h-3 w-3" />
													</a>
												) : (
													<span className="text-sm text-muted-foreground">
														—
													</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												<DropdownMenu>
													<DropdownMenuTrigger
														asChild
													>
														<Button
															variant="ghost"
															size="icon"
															aria-label="Domain actions"
														>
															<MoreHorizontalIcon className="h-4 w-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															asChild
														>
															<Link
																href={`/app/${organizationSlug}/domains/${domain.id}`}
															>
																<EyeIcon className="mr-2 h-4 w-4" />
																View Details
															</Link>
														</DropdownMenuItem>
														<DropdownMenuItem
															asChild
														>
															<Link
																href={`/app/${organizationSlug}/domains/${domain.id}/content`}
															>
																<SettingsIcon className="mr-2 h-4 w-4" />
																Manage Content
															</Link>
														</DropdownMenuItem>
														<DropdownMenuItem
															className="text-destructive focus:text-destructive"
															onClick={() =>
																deleteMutation.mutate(
																	{
																		organizationSlug,
																		id: domain.id,
																	},
																)
															}
														>
															<TrashIcon className="mr-2 h-4 w-4" />
															Delete
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									),
								)}
							</TableBody>
						</Table>
					</div>
				)}

				{/* Create Domain Dialog */}
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Add Domain</DialogTitle>
						</DialogHeader>
						<form
							onSubmit={handleSubmit(onSubmit)}
							className="space-y-4"
						>
							<div>
								<label
									htmlFor="domain-name"
									className="text-sm font-medium"
								>
									Domain Name
								</label>
								<Input
									id="domain-name"
									{...register("name")}
									placeholder="My Awesome Blog"
									className="mt-1"
								/>
								{errors.name && (
									<p className="mt-1 text-xs text-destructive">
										{errors.name.message}
									</p>
								)}
							</div>
							<div>
								<label
									htmlFor="domain-slug"
									className="text-sm font-medium"
								>
									Slug
								</label>
								<Input
									id="domain-slug"
									{...register("slug")}
									placeholder="my-awesome-blog"
									className="mt-1 font-mono"
								/>
								{errors.slug && (
									<p className="mt-1 text-xs text-destructive">
										{errors.slug.message}
									</p>
								)}
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setOpen(false)}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={createMutation.isPending}
								>
									{createMutation.isPending && (
										<Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
									)}
									{createMutation.isPending
										? "Creating..."
										: "Create Domain"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>
		</ErrorBoundary>
	);
}
