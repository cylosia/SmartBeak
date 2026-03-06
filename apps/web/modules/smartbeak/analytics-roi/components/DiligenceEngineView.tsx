"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import {
  ShieldCheckIcon,
  PlayIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  PencilIcon,
} from "lucide-react";
import { useState } from "react";

const STATUS_CONFIG = {
  passed: { icon: CheckCircleIcon, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  failed: { icon: XCircleIcon, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  pending: { icon: ClockIcon, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  skipped: { icon: ClockIcon, color: "text-muted-foreground", bg: "bg-muted/50" },
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

  const runMutation = useMutation(
    orpc.smartbeak.analyticsRoi.runDiligence.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "analyticsRoi", "getDiligenceReport"] });
        toastSuccess("Diligence checks completed");
      },
      onError: (e: Error) => toastError("Diligence failed", e.message),
    }),
  );

  const updateMutation = useMutation(
    orpc.smartbeak.analyticsRoi.updateDiligenceCheck.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "analyticsRoi", "getDiligenceReport"] });
        setEditingType(null);
        toastSuccess("Check updated");
      },
      onError: (e: Error) => toastError("Update failed", e.message),
    }),
  );

  if (reportQuery.isLoading) return <TableSkeleton rows={8} />;
  if (reportQuery.isError) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <p className="text-sm text-destructive">Failed to load diligence report.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => reportQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const report = reportQuery.data?.report;
  if (!report) return null;

  const scoreColor =
    report.score >= 80 ? "text-green-600 dark:text-green-400"
    : report.score >= 60 ? "text-amber-600 dark:text-amber-400"
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
                  <CardTitle className="text-base">Diligence Report</CardTitle>
                  <CardDescription>{domainName ?? domainId}</CardDescription>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => runMutation.mutate({ organizationSlug, domainId })}
                disabled={runMutation.isPending}
              >
                <PlayIcon className="mr-2 h-3.5 w-3.5" />
                {runMutation.isPending ? "Running…" : "Run All Checks"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <div className="text-center">
                <div className={`text-3xl font-bold ${scoreColor}`}>{report.score}%</div>
                <div className="mt-1 text-xs text-muted-foreground">Overall Score</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">{report.passed}</div>
                <div className="mt-1 text-xs text-muted-foreground">Passed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">{report.failed}</div>
                <div className="mt-1 text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{report.pending}</div>
                <div className="mt-1 text-xs text-muted-foreground">Pending</div>
              </div>
            </div>
            <Progress value={report.score} className="mt-4 h-2" />
          </CardContent>
        </Card>

        {/* Checks Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Check Results</CardTitle>
            <CardDescription>Click the edit icon to manually override any check status</CardDescription>
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
                {(report.checks ?? []).map((check) => {
                  const cfg = STATUS_CONFIG[check.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={check.id}>
                      <TableCell className="font-medium">
                        {TYPE_LABELS[check.type] ?? check.type}
                      </TableCell>
                      <TableCell>
                        <Badge className={`gap-1.5 ${cfg.bg} ${cfg.color} border`}>
                          <Icon className="h-3 w-3" />
                          {check.status ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {check.completedAt
                          ? new Date(check.completedAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {check.result
                          ? `Score: ${(check.result as Record<string, unknown>).weight ?? "—"}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Edit check"
                          onClick={() => setEditingType(editingType === check.type ? null : check.type)}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {report.checks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No checks run yet. Click "Run All Checks" to start automated diligence.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Inline Override Panel */}
        {editingType && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-sm">Override: {TYPE_LABELS[editingType] ?? editingType}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {(["passed", "failed", "pending", "skipped"] as const).map((s) => (
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
                        result: { manual: true, overriddenBy: "user" },
                      })
                    }
                  >
                    Mark {s}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setEditingType(null)}>
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
