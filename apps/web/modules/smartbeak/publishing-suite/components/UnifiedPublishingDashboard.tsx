"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
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
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  ActivityIcon,
  CheckCircleIcon,
  ClockIcon,
  GlobeIcon,
  MailIcon,
  LinkedinIcon,
  XCircleIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  web: GlobeIcon,
  email: MailIcon,
  linkedin: LinkedinIcon,
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
};

export function UnifiedPublishingDashboard({ organizationSlug }: { organizationSlug: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [targetFilter, setTargetFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery(
    orpc.smartbeak.publishingSuite.dashboard.queryOptions({
      input: {
        organizationSlug,
        limit: 100,
        offset: 0,
        status: statusFilter === "all" ? undefined : statusFilter,
        target: targetFilter === "all" ? undefined : targetFilter,
      },
    }),
  );

  const executeMutation = useMutation(
    orpc.smartbeak.publishingSuite.executeJob.mutationOptions({
      onSuccess: () => {
        toastSuccess("Job executed", "Publishing job dispatched successfully.");
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite"] });
      },
      onError: (err: unknown) => toastError("Execution failed", err instanceof Error ? err.message : "Unknown error"),
    }),
  );

  const data = dashboardQuery.data;
  const totals = data?.totals ?? { total: 0, pending: 0, running: 0, published: 0, failed: 0, cancelled: 0 };
  const byPlatform = data?.byPlatform ?? {};

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            title="Total Jobs"
            value={totals.total}
            icon={ActivityIcon}
          />
          <MetricCard
            title="Pending"
            value={totals.pending}
            icon={ClockIcon}
          />
          <MetricCard
            title="Running"
            value={totals.running}
            icon={RefreshCwIcon}
          />
          <MetricCard
            title="Published"
            value={totals.published}
            icon={CheckCircleIcon}
          />
          <MetricCard
            title="Failed"
            value={totals.failed}
            icon={XCircleIcon}
          />
        </div>

        {/* Platform breakdown */}
        {Object.keys(byPlatform).length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              By Platform
            </h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(byPlatform).map(([platform, stats]) => {
                const Icon = PLATFORM_ICONS[platform] ?? ActivityIcon;
                return (
                  <div
                    key={platform}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium capitalize">{platform}</span>
                    <span className="text-green-600 dark:text-green-400">{stats.published}✓</span>
                    {stats.failed > 0 && (
                      <span className="text-red-500 dark:text-red-400">{stats.failed}✗</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filters + job table */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <h3 className="flex-1 text-sm font-semibold">All Publishing Jobs</h3>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={targetFilter} onValueChange={setTargetFilter}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                {["web","email","linkedin","facebook","instagram","youtube","tiktok","pinterest","vimeo","soundcloud","wordpress"].map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dashboardQuery.refetch()}
              className="h-8 w-8 p-0"
            >
              <RefreshCwIcon className={`h-4 w-4 ${dashboardQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {dashboardQuery.isError ? (
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-sm text-destructive">Failed to load publishing jobs.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => dashboardQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : dashboardQuery.isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : !data?.jobs?.length ? (
            <EmptyState
              icon={SendIcon}
              title="No publishing jobs"
              description="Schedule content to publish across your connected platforms."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Executed</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((job: {
                  id: string;
                  target: string;
                  status: string;
                  scheduledFor: Date | string | null;
                  executedAt: Date | string | null;
                  error: string | null;
                }) => {
                  const Icon = PLATFORM_ICONS[job.target] ?? ActivityIcon;
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="capitalize font-medium">{job.target}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status] ?? ""}`}>
                          {job.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {job.scheduledFor
                          ? formatDistanceToNow(new Date(job.scheduledFor), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {job.executedAt
                          ? formatDistanceToNow(new Date(job.executedAt), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-red-500 dark:text-red-400">
                        {job.error ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(job.status === "pending" || job.status === "failed") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={executeMutation.isPending}
                            onClick={() =>
                              executeMutation.mutate({ organizationSlug, jobId: job.id })
                            }
                          >
                            <SendIcon className="mr-1 h-3 w-3" />
                            Execute
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
