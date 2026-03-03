"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Progress } from "@repo/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { toast } from "@repo/ui/components/toast";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { SearchIcon, PlusIcon, TrashIcon, TrendingUpIcon } from "lucide-react";

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
          if (!old || typeof old !== "object") return old;
          const data = old as { keywords: unknown[]; seoDoc: unknown };
          return {
            ...data,
            keywords: [
              ...data.keywords,
              {
                id: `temp-${Date.now()}`,
                keyword: variables.keyword,
                volume: variables.volume ?? null,
                difficulty: variables.difficulty ?? null,
                position: variables.position ?? null,
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
        toast({ title: "Keyword added" });
      },
      onError: (err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(seoQueryKey, context.previous);
        }
        toast({ title: "Error", description: err.message, variant: "error" });
      },
    }),
  );

  const removeKeywordMutation = useMutation(
    orpc.smartbeak.seo.removeKeyword.mutationOptions({
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: seoQueryKey });
        const previous = queryClient.getQueryData(seoQueryKey);
        queryClient.setQueryData(seoQueryKey, (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const data = old as { keywords: Array<{ id: string }>; seoDoc: unknown };
          return {
            ...data,
            keywords: data.keywords.filter((k) => k.id !== variables.id),
          };
        });
        return { previous };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: seoQueryKey });
        toast({ title: "Keyword removed" });
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(seoQueryKey, context.previous);
        }
        toast({ title: "Error", description: "Failed to remove keyword.", variant: "error" });
      },
    }),
  );

  const seoDoc = seoQuery.data?.seoDoc;
  const keywords = seoQuery.data?.keywords ?? [];

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* SEO Score Card */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                SEO Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {seoDoc?.score ?? 0}
                <span className="text-base font-normal text-muted-foreground">
                  /100
                </span>
              </div>
              <Progress
                value={seoDoc?.score ?? 0}
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Keywords Tracked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{keywords.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Active keyword targets
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg. Position
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {keywords.length > 0
                  ? Math.round(
                      keywords.reduce((sum, k) => sum + (k.position ?? 0), 0) /
                        keywords.length,
                    )
                  : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Average SERP position
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Add Keyword */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add keyword to track..."
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
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
            <PlusIcon className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        {/* Keywords Table */}
        {seoQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : keywords.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="No keywords tracked"
            description="Add keywords to monitor your search engine rankings."
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.map((kw) => (
                  <TableRow key={kw.id}>
                    <TableCell className="font-medium">{kw.keyword}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {kw.volume?.toLocaleString() ?? "—"}
                    </TableCell>
                    <TableCell>
                      {kw.difficulty !== null && kw.difficulty !== undefined ? (
                        <div className="flex items-center gap-2">
                          <Progress
                            value={kw.difficulty}
                            className="h-1.5 w-16"
                          />
                          <span className="text-xs text-muted-foreground">
                            {kw.difficulty}
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {kw.position ? (
                        <div className="flex items-center gap-1">
                          <TrendingUpIcon className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-sm font-medium">
                            #{kw.position}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove keyword ${kw.keyword}`}
                        onClick={() =>
                          removeKeywordMutation.mutate({
                            organizationSlug,
                            id: kw.id,
                          })
                        }
                      >
                        <TrashIcon className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
