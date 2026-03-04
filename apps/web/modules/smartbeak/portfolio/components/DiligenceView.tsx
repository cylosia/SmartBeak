"use client";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
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

interface DiligenceCheck {
  id: string;
  type: string;
  result: unknown;
  status: string | null;
  completedAt: string | null;
}

interface DecaySignal {
  id: string;
  signalType: string;
  decayFactor: string;
  recordedAt: string;
}

interface BuyerSession {
  id: string;
  sessionId: string;
  buyerEmail: string | null;
  intent: string | null;
  createdAt: string;
}

interface TimelineEvent {
  id: string;
  eventType: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface DiligenceData {
  diligenceChecks?: DiligenceCheck[];
  decaySignals?: DecaySignal[];
  buyerSessions?: BuyerSession[];
  timeline?: TimelineEvent[];
}

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

  const {
    diligenceChecks = [],
    decaySignals = [],
    buyerSessions = [],
    timeline = [],
  } = (diligenceQuery.data as DiligenceData | undefined) ?? {};

  const passCount = diligenceChecks.filter((c) => c.status === "pass").length;
  const warnCount = diligenceChecks.filter((c) => c.status === "warn").length;
  const failCount = diligenceChecks.filter((c) => c.status === "fail").length;

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Summary Cards */}
        {diligenceQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-destructive">Failed to load diligence data.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => diligenceQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : diligenceQuery.isLoading ? (
          <CardGridSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Checks Passing"
              value={passCount}
              subtitle={`${warnCount} warnings, ${failCount} failures`}
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
                    <TableHead>Result</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diligenceChecks.map((check) => (
                    <TableRow key={check.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <DiligenceIcon status={check.status ?? "fail"} />
                          {check.type}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={check.status ?? "fail"} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {check.result
                          ? typeof check.result === "object"
                            ? JSON.stringify(check.result)
                            : String(check.result)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {check.completedAt
                          ? formatDistanceToNow(new Date(check.completedAt), {
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
                    <TableHead>Decay Factor</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decaySignals.map((signal) => (
                    <TableRow key={signal.id}>
                      <TableCell className="font-medium">
                        {signal.signalType}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={
                            Number(signal.decayFactor) >= 0.7
                              ? "fail"
                              : Number(signal.decayFactor) >= 0.4
                                ? "warn"
                                : "pass"
                          }
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {signal.decayFactor ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {signal.recordedAt
                          ? formatDistanceToNow(new Date(signal.recordedAt), {
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
                    <TableHead>Buyer</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyerSessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-mono text-xs">
                        {session.sessionId?.slice(0, 8) ?? session.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="text-sm">
                        {session.buyerEmail ?? "Anonymous"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {session.intent ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {session.createdAt
                          ? formatDistanceToNow(new Date(session.createdAt), {
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

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ClockIcon className="h-4 w-4" />
              Domain Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diligenceQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No timeline events recorded.
              </p>
            ) : (
              <div className="relative space-y-0">
                {timeline.map((event, idx) => (
                  <div key={event.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 ring-2 ring-background">
                        <ClockIcon className="h-3 w-3 text-primary" />
                      </div>
                      {idx < timeline.length - 1 && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="pb-6">
                      <p className="text-sm font-medium capitalize">
                        {(event.eventType ?? "event").replace(/_/g, " ")}
                      </p>
                      {event.details && typeof event.details === "object" && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {Object.entries(event.details as Record<string, unknown>)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {event.createdAt
                          ? formatDistanceToNow(new Date(event.createdAt), {
                              addSuffix: true,
                            })
                          : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
