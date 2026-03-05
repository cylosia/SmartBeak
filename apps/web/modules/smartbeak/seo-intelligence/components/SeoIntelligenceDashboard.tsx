"use client";

import { orpc } from "@/modules/smartbeak/shared/lib/api";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Progress } from "@repo/ui/components/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/ui/components/tooltip";
import { toastSuccess, toastError, toastInfo } from "@repo/ui/components/toast";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import React, { useState } from "react";
import { AiIdeaPanel } from "./AiIdeaPanel";
import { ContentOptimizerPanel } from "./ContentOptimizerPanel";
import { GscSyncDialog } from "./GscSyncDialog";

interface Props {
  organizationSlug: string;
  domainId: string;
}

function DecayBadge({ factor }: { factor: string | null }) {
  const val = parseFloat(factor ?? "1");
  if (val >= 0.7)
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
        <CheckCircle2Icon className="mr-1 h-3 w-3" />
        Fresh
      </Badge>
    );
  if (val >= 0.5)
    return (
      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
        <AlertTriangleIcon className="mr-1 h-3 w-3" />
        Aging
      </Badge>
    );
  return (
    <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 text-xs">
      <TrendingDownIcon className="mr-1 h-3 w-3" />
      Decaying
    </Badge>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-emerald-500 dark:text-emerald-400"
      : score >= 40
        ? "text-amber-500 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/20"
        />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={`${(score / 100) * 213.6} 213.6`}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className={`text-xl font-bold ${color}`}>{score}</span>
    </div>
  );
}

export function SeoIntelligenceDashboard({ organizationSlug, domainId }: Props) {
  const qc = useQueryClient();
  const [newKeyword, setNewKeyword] = useState("");
  const [activeTab, setActiveTab] = useState("keywords");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showOptimizerPanel, setShowOptimizerPanel] = useState(false);
  const [showGscDialog, setShowGscDialog] = useState(false);

  const dashboardQuery = useQuery(
    orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
      input: { organizationSlug, domainId },
    }),
  );

  const addKeywordMutation = useMutation(
    orpc.smartbeak.seo.addKeyword.mutationOptions({
      onMutate: async (vars) => {
        await qc.cancelQueries(
          orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
            input: { organizationSlug, domainId },
          }),
        );
        return {};
      },
      onSuccess: () => {
        setNewKeyword("");
        qc.invalidateQueries(
          orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
            input: { organizationSlug, domainId },
          }),
        );
        toastSuccess("Keyword added", "Tracking started.");
      },
      onError: () => {
        toastError("Failed to add keyword");
      },
    }),
  );

  const removeKeywordMutation = useMutation(
    orpc.smartbeak.seo.removeKeyword.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries(
          orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
            input: { organizationSlug, domainId },
          }),
        );
        toastSuccess("Keyword removed");
      },
      onError: () => {
        toastError("Failed to remove keyword");
      },
    }),
  );

  const updateMetricsMutation = useMutation(
    orpc.smartbeak.seoIntelligence.updateKeyword.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries(
          orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
            input: { organizationSlug, domainId },
          }),
        );
      },
    }),
  );

  const { summary, keywords = [], clusters = [] } =
    dashboardQuery.data ?? {};

  const decayingCount = keywords.filter(
    (k) => parseFloat(k.decayFactor ?? "1") < 0.5,
  ).length;

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Header actions */}
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGscDialog(true)}
            >
              <ExternalLinkIcon className="mr-2 h-4 w-4" />
              Sync GSC
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toastInfo(
                  "Ahrefs sync",
                  "Configure your Ahrefs API key in settings to enable this.",
                )
              }
            >
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              Sync Ahrefs
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOptimizerPanel(true)}
            >
              <ZapIcon className="mr-2 h-4 w-4 text-amber-500 dark:text-amber-400" />
              Content Optimizer
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAiPanel(true)}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
            >
              <SparklesIcon className="mr-2 h-4 w-4" />
              AI Idea Generator
            </Button>
          </div>
        </div>

        {/* Error state */}
        {dashboardQuery.isError && (
          <Card className="border-destructive/50">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <AlertTriangleIcon className="h-5 w-5 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium">Failed to load dashboard</p>
                  <p className="text-xs text-muted-foreground">
                    {dashboardQuery.error?.message ?? "An unexpected error occurred."}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => dashboardQuery.refetch()}>
                <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {/* SEO Score ring */}
          <Card className="col-span-2 md:col-span-1 flex flex-col items-center justify-center p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">SEO Score</p>
            {dashboardQuery.isLoading ? (
              <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
            ) : (
              <ScoreRing score={summary?.seoScore ?? 0} />
            )}
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Keywords
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold">
                {dashboardQuery.isLoading ? "—" : (summary?.totalKeywords ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground">Tracked</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Avg. Position
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold">
                {dashboardQuery.isLoading
                  ? "—"
                  : summary?.avgPosition
                    ? `#${summary.avgPosition}`
                    : "—"}
              </div>
              <p className="text-xs text-muted-foreground">SERP rank</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Top 10
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {dashboardQuery.isLoading ? "—" : (summary?.topPositionKeywords ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground">Keywords</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Decaying
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div
                className={`text-2xl font-bold ${decayingCount > 0 ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}
              >
                {dashboardQuery.isLoading ? "—" : decayingCount}
              </div>
              <p className="text-xs text-muted-foreground">Need refresh</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Integrations
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-1">
              <div className="flex items-center gap-1.5">
                {summary?.gscConnected ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <XCircleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs">GSC</span>
              </div>
              <div className="flex items-center gap-1.5">
                {summary?.ahrefsConnected ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <XCircleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs">Ahrefs</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="keywords">
              <SearchIcon className="mr-2 h-4 w-4" />
              Keywords
            </TabsTrigger>
            <TabsTrigger value="clusters">
              <LayersIcon className="mr-2 h-4 w-4" />
              Clusters
            </TabsTrigger>
            <TabsTrigger value="decay">
              <TrendingDownIcon className="mr-2 h-4 w-4" />
              Decay Signals
              {decayingCount > 0 && (
                <Badge className="ml-2 bg-red-500 text-white text-xs px-1.5 py-0">
                  {decayingCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Keywords Tab */}
          <TabsContent value="keywords" className="space-y-4 mt-4">
            {/* Add keyword */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add keyword to track (e.g. 'best crm software')..."
                value={newKeyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKeyword(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter" && newKeyword.trim()) {
                    addKeywordMutation.mutate({
                      organizationSlug,
                      domainId,
                      keyword: newKeyword.trim(),
                    });
                  }
                }}
                className="max-w-md"
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
                disabled={addKeywordMutation.isPending || !newKeyword.trim()}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Track
              </Button>
            </div>

            {dashboardQuery.isLoading ? (
              <TableSkeleton rows={6} />
            ) : keywords.length === 0 ? (
              <EmptyState
                icon={SearchIcon}
                title="No keywords tracked yet"
                description="Add keywords manually or sync from Google Search Console or Ahrefs."
              />
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Keyword</TableHead>
                      <TableHead>Volume</TableHead>
                      <TableHead>Difficulty</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Decay</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keywords.map((kw) => (
                      <TableRow key={kw.id} className="group">
                        <TableCell className="font-medium">{kw.keyword}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {kw.volume?.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell>
                          {kw.difficulty !== null && kw.difficulty !== undefined ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-2 cursor-default">
                                    <Progress
                                      value={kw.difficulty}
                                      className="h-1.5 w-16"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      {kw.difficulty}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Keyword difficulty: {kw.difficulty}/100
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {kw.position ? (
                            <div className="flex items-center gap-1">
                              {kw.position <= 10 ? (
                                <TrendingUpIcon className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                              ) : (
                                <BarChart3Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <span
                                className={`text-sm font-medium ${kw.position <= 10 ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                              >
                                #{kw.position}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DecayBadge factor={kw.decayFactor} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() =>
                              removeKeywordMutation.mutate({
                                organizationSlug,
                                id: kw.id,
                              })
                            }
                            disabled={removeKeywordMutation.isPending}
                          >
                            <XCircleIcon className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Clusters Tab */}
          <TabsContent value="clusters" className="mt-4">
            {dashboardQuery.isLoading ? (
              <TableSkeleton rows={5} />
            ) : clusters.length === 0 ? (
              <EmptyState
                icon={LayersIcon}
                title="No keyword clusters yet"
                description="Add at least 3 keywords to see topic clusters emerge."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clusters.map((cluster) => (
                  <Card
                    key={cluster.cluster}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm capitalize">
                        {cluster.cluster}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {cluster.count} keyword{cluster.count !== 1 ? "s" : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Avg. Position</span>
                        <span className="font-medium">
                          {cluster.avgPosition ? `#${cluster.avgPosition}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total Volume</span>
                        <span className="font-medium">
                          {cluster.totalVolume?.toLocaleString() ?? "—"}
                        </span>
                      </div>
                      <Progress
                        value={Math.min(100, (cluster.count / 10) * 100)}
                        className="h-1 mt-2"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Decay Signals Tab */}
          <TabsContent value="decay" className="mt-4">
            {dashboardQuery.isLoading ? (
              <TableSkeleton rows={4} />
            ) : decayingCount === 0 ? (
              <EmptyState
                icon={CheckCircle2Icon}
                title="All keywords are fresh"
                description="No keywords are currently showing decay signals. Keep tracking!"
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangleIcon className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {decayingCount} keyword{decayingCount !== 1 ? "s are" : " is"} showing
                    decay signals. Update content or refresh rankings to restore scores.
                  </p>
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>Keyword</TableHead>
                        <TableHead>Decay Factor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Updated</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keywords
                        .filter(
                          (k) => parseFloat(k.decayFactor ?? "1") < 0.5,
                        )
                        .sort(
                          (a, b) =>
                            parseFloat(a.decayFactor ?? "1") -
                            parseFloat(b.decayFactor ?? "1"),
                        )
                        .map((kw) => {
                          const decay = parseFloat(kw.decayFactor ?? "1");
                          return (
                            <TableRow key={kw.id}>
                              <TableCell className="font-medium">
                                {kw.keyword}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Progress
                                    value={decay * 100}
                                    className="h-1.5 w-20"
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    {(decay * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <DecayBadge factor={kw.decayFactor} />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(kw.lastUpdated).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateMetricsMutation.mutate({
                                      organizationSlug,
                                      id: kw.id,
                                    })
                                  }
                                  disabled={updateMetricsMutation.isPending}
                                >
                                  <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                                  Refresh
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Panels */}
        {showAiPanel && (
          <AiIdeaPanel
            organizationSlug={organizationSlug}
            domainId={domainId}
            onClose={() => setShowAiPanel(false)}
          />
        )}
        {showOptimizerPanel && (
          <ContentOptimizerPanel
            organizationSlug={organizationSlug}
            domainId={domainId}
            onClose={() => setShowOptimizerPanel(false)}
          />
        )}
        {showGscDialog && (
          <GscSyncDialog
            organizationSlug={organizationSlug}
            domainId={domainId}
            onClose={() => setShowGscDialog(false)}
            onSuccess={() => {
              setShowGscDialog(false);
              qc.invalidateQueries(
                orpc.smartbeak.seoIntelligence.getKeywordDashboard.queryOptions({
                  input: { organizationSlug, domainId },
                }),
              );
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
