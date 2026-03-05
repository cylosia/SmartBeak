"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { useOrpcQuery } from "@/modules/shared/lib/orpc-query-utils";

interface SessionsPageProps {
  params: { organizationSlug: string };
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <ClockIcon className="h-4 w-4 text-yellow-500" />,
  running: <Loader2Icon className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle2Icon className="h-4 w-4 text-green-500" />,
  failed: <XCircleIcon className="h-4 w-4 text-destructive" />,
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  running: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  completed: "bg-green-500/10 text-green-700 border-green-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function SessionsPage({ params }: SessionsPageProps) {
  const { organizationSlug } = params;
  const { orpc } = useOrpcQuery();

  const sessionsQuery = useQuery(
    orpc.aiAgents.listSessions.queryOptions({
      input: { organizationSlug, limit: 50 },
    }),
  );

  const sessions = (sessionsQuery.data as { sessions: Array<{
    id: string;
    status: string;
    costCents: number | null;
    durationMs: number | null;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    workflow: { name: string } | null;
  }> })?.sessions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Sessions</h2>
        <p className="text-sm text-muted-foreground">
          Execution history for all workflow runs.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <SparklesIcon className="h-4 w-4" />
            Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 rounded" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <SparklesIcon className="h-10 w-10 opacity-20" />
              <p className="text-sm">No sessions yet. Run a workflow to see history here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {STATUS_ICONS[session.status] ?? STATUS_ICONS.pending}
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${STATUS_BADGE[session.status] ?? ""}`}
                        >
                          {session.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {session.workflow?.name ?? "Ad-hoc"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {session.costCents != null
                        ? `$${(session.costCents / 100).toFixed(4)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {session.totalInputTokens != null &&
                      session.totalOutputTokens != null
                        ? (
                            session.totalInputTokens +
                            session.totalOutputTokens
                          ).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {session.durationMs != null
                        ? `${(session.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {new Date(session.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
