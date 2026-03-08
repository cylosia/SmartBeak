"use client";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/tabs";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BarChart3Icon,
	LinkIcon,
	Loader2Icon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
	CardGridSkeleton,
	TableSkeleton,
} from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { IntegrationsPanel } from "./IntegrationsPanel";

const KeywordDataTable = dynamic(
	() => import("./KeywordDataTable").then((m) => m.KeywordDataTable),
	{
		ssr: false,
		loading: () => (
			<div className="animate-pulse h-64 rounded-lg bg-muted" />
		),
	},
);
const SeoDashboard = dynamic(
	() => import("./SeoDashboard").then((m) => m.SeoDashboard),
	{
		ssr: false,
		loading: () => (
			<div className="animate-pulse h-64 rounded-lg bg-muted" />
		),
	},
);

export function SeoView({
	organizationSlug,
	domainId,
}: {
	organizationSlug: string;
	domainId: string;
}) {
	const [newKeyword, setNewKeyword] = useState("");
	const queryClient = useQueryClient();

	const seoQuery = useQuery(
		orpc.smartbeak.seo.get.queryOptions({
			input: { organizationSlug, domainId },
		}),
	);

	const seoQueryKey = orpc.smartbeak.seo.get.key({
		input: { organizationSlug, domainId },
	});

	const addKeywordMutation = useMutation(
		orpc.smartbeak.seo.addKeyword.mutationOptions({
			onMutate: async (variables) => {
				await queryClient.cancelQueries({ queryKey: seoQueryKey });
				const previous = queryClient.getQueryData(seoQueryKey);
				queryClient.setQueryData(seoQueryKey, (old: unknown) => {
					if (!old || typeof old !== "object") {
						return old;
					}
					const data = old as {
						keywords?: unknown[];
						seoDoc: unknown;
					};
					return {
						...data,
						keywords: [
							...(data.keywords ?? []),
							{
								id: `temp-${Date.now()}`,
								keyword: variables.keyword,
								volume: variables.volume ?? null,
								difficulty: variables.difficulty ?? null,
								position: variables.position ?? null,
								decayFactor: null,
								lastUpdated: new Date().toISOString(),
								domainId,
							},
						],
					};
				});
				setNewKeyword("");
				return { previous };
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: seoQueryKey });
				toastSuccess("Keyword added");
			},
			onError: (err, _vars, context) => {
				if (context?.previous) {
					queryClient.setQueryData(seoQueryKey, context.previous);
				}
				toastError("Error", err.message);
			},
		}),
	);

	const removeKeywordMutation = useMutation(
		orpc.smartbeak.seo.removeKeyword.mutationOptions({
			onMutate: async (variables) => {
				await queryClient.cancelQueries({ queryKey: seoQueryKey });
				const previous = queryClient.getQueryData(seoQueryKey);
				queryClient.setQueryData(seoQueryKey, (old: unknown) => {
					if (!old || typeof old !== "object") {
						return old;
					}
					const data = old as {
						keywords?: Array<{ id: string }>;
						seoDoc: unknown;
					};
					return {
						...data,
						keywords: (data.keywords ?? []).filter(
							(k) => k.id !== variables.id,
						),
					};
				});
				return { previous };
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: seoQueryKey });
				toastSuccess("Keyword removed");
			},
			onError: (_err, _vars, context) => {
				if (context?.previous) {
					queryClient.setQueryData(seoQueryKey, context.previous);
				}
				toastError("Error", "Failed to remove keyword.");
			},
		}),
	);

	const seoDoc = seoQuery.data?.seoDoc as
		| {
				score: number | null;
				updatedAt: string | Date;
				gscData?: Record<string, unknown> | null;
				ahrefsData?: Record<string, unknown> | null;
		  }
		| null
		| undefined;

	const keywords = (seoQuery.data?.keywords ?? []) as Array<{
		id: string;
		keyword: string;
		volume: number | null;
		difficulty: number | null;
		position: number | null;
		decayFactor: string | null;
		lastUpdated: string | Date;
	}>;

	async function handleBulkDelete(ids: string[]) {
		for (const id of ids) {
			await removeKeywordMutation.mutateAsync({ organizationSlug, id });
		}
	}

	if (seoQuery.isError) {
		return (
			<ErrorBoundary>
				<div className="flex flex-col items-center py-12 text-center">
					<p className="text-sm text-destructive">
						Failed to load SEO data.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => seoQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			</ErrorBoundary>
		);
	}

	if (seoQuery.isLoading) {
		return (
			<div className="space-y-6">
				<CardGridSkeleton count={4} />
				<TableSkeleton rows={5} />
			</div>
		);
	}

	return (
		<ErrorBoundary>
			<Tabs defaultValue="dashboard" className="space-y-6">
				<TabsList>
					<TabsTrigger value="dashboard" className="gap-1.5">
						<BarChart3Icon className="h-3.5 w-3.5" />
						Dashboard
					</TabsTrigger>
					<TabsTrigger value="keywords" className="gap-1.5">
						<SearchIcon className="h-3.5 w-3.5" />
						Keywords
					</TabsTrigger>
					<TabsTrigger value="integrations" className="gap-1.5">
						<LinkIcon className="h-3.5 w-3.5" />
						Integrations
					</TabsTrigger>
				</TabsList>

				<TabsContent value="dashboard" className="space-y-6">
					<SeoDashboard seoDoc={seoDoc} keywords={keywords} />
				</TabsContent>

				<TabsContent value="keywords" className="space-y-6">
					<div className="flex items-center gap-2">
						<Input
							placeholder="Add keyword to track..."
							value={newKeyword}
							onChange={(e) => setNewKeyword(e.target.value)}
							aria-label="Add keyword to track"
							onKeyDown={(e) => {
								if (e.key === "Enter" && newKeyword.trim()) {
									addKeywordMutation.mutate({
										organizationSlug,
										domainId,
										keyword: newKeyword.trim(),
									});
								}
							}}
							className="max-w-sm"
						/>
						<Button
							onClick={() => {
								if (newKeyword.trim()) {
									addKeywordMutation.mutate({
										organizationSlug,
										domainId,
										keyword: newKeyword.trim(),
									});
								}
							}}
							disabled={addKeywordMutation.isPending}
						>
							{addKeywordMutation.isPending ? (
								<Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
							) : (
								<PlusIcon className="mr-1.5 h-4 w-4" />
							)}
							Add
						</Button>
					</div>

					{keywords.length === 0 ? (
						<EmptyState
							icon={SearchIcon}
							title="No keywords tracked"
							description="Add keywords above to monitor your search engine rankings."
						/>
					) : (
						<KeywordDataTable
							data={keywords}
							onDelete={handleBulkDelete}
							isDeleting={removeKeywordMutation.isPending}
						/>
					)}
				</TabsContent>

				<TabsContent value="integrations" className="space-y-6">
					<IntegrationsPanel seoDoc={seoDoc} />
				</TabsContent>
			</Tabs>
		</ErrorBoundary>
	);
}
