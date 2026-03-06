"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function isSafeUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  ZapIcon,
  GlobeIcon,
  RocketIcon,
  ExternalLinkIcon,
  Loader2Icon,
  EyeIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function SmartDeployView({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const queryClient = useQueryClient();
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");
  const [selectedThemeId, setSelectedThemeId] = useState<string>("landing-leadgen");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const domainsQuery = useQuery(
    orpc.smartbeak.domains.list.queryOptions({
      input: { organizationSlug, limit: 100, offset: 0 },
    }),
  );

  const themesQuery = useQuery(
    orpc.smartbeak.deploy.themes.queryOptions({
      input: {},
    }),
  );

  const deployStatusQuery = useQuery(
    orpc.smartbeak.deploy.status.queryOptions({
      input: { organizationSlug, domainId: selectedDomainId },
      enabled: !!selectedDomainId,
      refetchInterval: (query) => {
        const latest = query.state.data?.latest;
        if (latest && (latest.status === "building" || latest.status === "deploying")) {
          return 3000;
        }
        return false;
      },
    }),
  );

  const deployMutation = useMutation(
    orpc.smartbeak.deploy.trigger.mutationOptions({
      onSuccess: (data) => {
        toastSuccess(
          "Deployment started",
          `Version ${data.shard.version} is being deployed.`,
        );
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.deploy.status.key(),
        });
      },
      onError: (err) => {
        toastError("Deploy failed", err.message);
      },
    }),
  );

  const handleDeploy = () => {
    if (!selectedDomainId) {
      toastError("Select a domain", "Choose a domain to deploy.");
      return;
    }
    deployMutation.mutate({
      organizationSlug,
      domainId: selectedDomainId,
      themeId: selectedThemeId as "affiliate-comparison" | "authority-site" | "landing-leadgen" | "local-business" | "media-newsletter",
    });
  };

  const latest = deployStatusQuery.data?.latest;
  const shards = deployStatusQuery.data?.shards ?? [];
  const isDeploying = latest?.status === "building" || latest?.status === "deploying";

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Deploy Card */}
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-2 ring-primary/20">
                <ZapIcon className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">SmartDeploy</h2>
                <p className="mt-1 text-muted-foreground max-w-md">
                  Deploy your site to Vercel's global edge network. Select a domain and theme, then deploy.
                </p>
              </div>

              <div className="flex flex-col gap-4 w-full max-w-md">
                {(domainsQuery.isError || themesQuery.isError) && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
                    <span>
                      {domainsQuery.isError && themesQuery.isError
                        ? "Failed to load domains and themes."
                        : domainsQuery.isError
                          ? "Failed to load domains."
                          : "Failed to load themes."}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (domainsQuery.isError) domainsQuery.refetch();
                        if (themesQuery.isError) themesQuery.refetch();
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select value={selectedDomainId} onValueChange={setSelectedDomainId}>
                    <SelectTrigger>
                      <SelectValue placeholder={domainsQuery.isLoading ? "Loading..." : "Select domain"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(domainsQuery.data?.items ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={selectedThemeId} onValueChange={setSelectedThemeId}>
                    <SelectTrigger>
                      <SelectValue placeholder={themesQuery.isLoading ? "Loading..." : "Select theme"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(themesQuery.data?.themes ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  size="lg"
                  onClick={handleDeploy}
                  disabled={deployMutation.isPending || isDeploying || !selectedDomainId}
                  className="w-full"
                >
                  {deployMutation.isPending || isDeploying ? (
                    <>
                      <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
                      {isDeploying ? "Deploying..." : "Starting..."}
                    </>
                  ) : (
                    <>
                      <RocketIcon className="mr-2 h-5 w-5" />
                      Deploy Site
                    </>
                  )}
                </Button>
              </div>

              {latest?.status === "deployed" && isSafeUrl(latest.deployedUrl) && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3">
                  <GlobeIcon className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
                      Live at{" "}
                      <a
                        href={latest.deployedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {latest.deployedUrl}
                      </a>
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                      Version {latest.version} &bull; Deployed{" "}
                      {latest.createdAt
                        ? formatDistanceToNow(new Date(latest.createdAt), { addSuffix: true })
                        : "recently"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto flex-shrink-0"
                    onClick={() => setPreviewUrl(latest.deployedUrl)}
                    aria-label="Preview deployed site"
                  >
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {latest?.status === "error" && (
                <Badge className="border text-red-600 border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                  Last deployment failed — try again
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Live Preview */}
        {previewUrl && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <EyeIcon className="h-4 w-4" />
                Live Preview
              </CardTitle>
              <div className="flex items-center gap-2">
                <a href={isSafeUrl(previewUrl) ? previewUrl : "#"} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLinkIcon className="mr-2 h-3.5 w-3.5" />
                    Open
                  </Button>
                </a>
                <Button variant="ghost" size="sm" onClick={() => setPreviewUrl(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="rounded-b-xl overflow-hidden border-t border-border">
                {isSafeUrl(previewUrl) && (
                  <iframe
                    src={previewUrl}
                    title="Site preview"
                    className="w-full h-[600px] bg-muted"
                    sandbox="allow-scripts allow-same-origin"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deployment History */}
        {selectedDomainId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Deployment History</CardTitle>
            </CardHeader>
            <CardContent>
              {deployStatusQuery.isError ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <p className="text-sm text-destructive">Failed to load deployment status.</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => deployStatusQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : deployStatusQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : shards.length === 0 ? (
                <EmptyState
                  icon={RocketIcon}
                  title="No deployments yet"
                  description="Deploy this domain to see version history here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shards.map((shard) => (
                      <TableRow key={shard.id}>
                        <TableCell className="font-mono text-sm font-medium">
                          v{shard.version}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={shard.status ?? "pending"} />
                        </TableCell>
                        <TableCell>
                          {isSafeUrl(shard.deployedUrl) ? (
                            <a
                              href={shard.deployedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary underline-offset-4 hover:underline flex items-center gap-1"
                            >
                              {(() => { try { return new URL(shard.deployedUrl).hostname; } catch { return shard.deployedUrl; } })()}
                              <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {shard.createdAt
                            ? formatDistanceToNow(new Date(shard.createdAt), {
                                addSuffix: true,
                              })
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </ErrorBoundary>
  );
}
