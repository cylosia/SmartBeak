"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Input } from "@repo/ui/components/input";
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
import { Badge } from "@repo/ui/components/badge";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { ShieldIcon, SearchIcon } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const ENTITY_TYPES = [
  "all",
  "domain",
  "content_item",
  "media_asset",
  "publishing_job",
  "seo_document",
] as const;

const ACTION_COLOR: Record<string, string> = {
  created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  updated: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  deleted: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  published: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
};

function getActionColor(action: string): string {
  for (const [key, cls] of Object.entries(ACTION_COLOR)) {
    if (action.includes(key)) return cls;
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function AuditLogView({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [entityType, setEntityType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const auditQuery = useQuery(
    orpc.smartbeak.audit.list.queryOptions({
      input: {
        organizationSlug,
        entityType: entityType !== "all" ? entityType : undefined,
        limit: 100,
        offset: 0,
      },
    }),
  );

  const events = (auditQuery.data?.events ?? []).filter((e) =>
    search
      ? e.action?.toLowerCase().includes(search.toLowerCase()) ||
        e.entityType?.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search actions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 max-w-xs"
            />
          </div>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t === "all" ? "All entity types" : t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">
            {events.length} events
          </span>
        </div>

        {/* Table */}
        {auditQuery.isLoading ? (
          <TableSkeleton rows={8} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={ShieldIcon}
            title="No audit events"
            description="Actions taken in this organization will appear here."
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getActionColor(event.action ?? "")}`}
                      >
                        {event.action}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {event.entityType?.replace(/_/g, " ")}
                        </p>
                        {event.entityId && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {event.entityId.slice(0, 8)}…
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {event.actorId ? event.actorId.slice(0, 8) + "…" : "system"}
                    </TableCell>
                    <TableCell>
                      {event.details ? (
                        <code className="text-xs bg-muted rounded px-1.5 py-0.5 max-w-xs truncate block">
                          {JSON.stringify(event.details).slice(0, 60)}
                        </code>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {event.createdAt
                        ? formatDistanceToNow(new Date(event.createdAt), {
                            addSuffix: true,
                          })
                        : "—"}
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
