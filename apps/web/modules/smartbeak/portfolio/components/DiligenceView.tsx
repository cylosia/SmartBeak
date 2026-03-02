"use client";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton, TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  XCircleIcon,
  TrendingDownIcon,
  UsersIcon,
  ClockIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function DiligenceIcon({ status }: { status: string }) {
  if (status === "pass")
    return <CheckCircleIcon className="h-4 w-4 text-emerald-500" />;
  if (status === "warn")
    return <AlertTriangleIcon className="h-4 w-4 text-amber-500" />;
  return <XCircleIcon className="h-4 w-4 text-red-500" />;
}

export function DiligenceView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const diligenceQuery = useQuery(
    orpc.smartbeak.portfolio.getDiligence.queryOptions({
      input: { organizationSlug, domainId },
    }),
  );

  const { diligenceChecks = [], decaySignals = [], buyerSessions = [] } =
    diligenceQuery.data ?? {};

  const passCount = diligenceChecks.filter((c) => c.status === "pass").length;
  const warnCount = diligenceChecks.filter((c) => c.status === "warn").length;
  const failCount = diligenceChecks.filter((c) => c.status === "fail").length;

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Summary Cards */}
        {diligenceQuery.isLoading ? (
          <CardGridSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Checks Passing"
              value={passCount}
              subtitle={`of ${diligenceChecks.length} total checks`}
              icon={CheckCircleIcon}
            />
            <MetricCard
              title="Decay Signals"
              value={decaySignals.length}
              subtitle="Active monetization decay indicators"
              icon={TrendingDownIcon}
            />
            <MetricCard
              title="Buyer Sessions"
              value={buyerSessions.length}
              subtitle="Recorded buyer interest sessions"
              icon={UsersIcon}
            />
          </div>
        )}

        {/* Diligence Checks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Diligence Checks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diligenceQuery.isLoading ? (
              <TableSkeleton rows={4} />
            ) : diligenceChecks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No diligence checks recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Last Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diligenceChecks.map((check) => (
                    <TableRow key={check.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <DiligenceIcon status={check.status ?? "fail"} />
                          {check.checkName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={check.status ?? "fail"} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {check.score ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {check.notes ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {check.checkedAt
                          ? formatDistanceToNow(new Date(check.checkedAt), {
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

        {/* Decay Signals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDownIcon className="h-4 w-4 text-amber-500" />
              Monetization Decay Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diligenceQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : decaySignals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No decay signals detected. Domain health looks good.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decaySignals.map((signal) => (
                    <TableRow key={signal.id}>
                      <TableCell className="font-medium">
                        {signal.signalType}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={signal.severity ?? "warn"} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {signal.value ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {signal.detectedAt
                          ? formatDistanceToNow(new Date(signal.detectedAt), {
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

        {/* Buyer Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UsersIcon className="h-4 w-4" />
              Buyer Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diligenceQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : buyerSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No buyer sessions recorded.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session ID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyerSessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-mono text-xs">
                        {session.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="text-sm">
                        {session.source ?? "Direct"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {session.durationSeconds
                          ? `${session.durationSeconds}s`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {session.startedAt
                          ? formatDistanceToNow(new Date(session.startedAt), {
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
      </div>
    </ErrorBoundary>
  );
}
