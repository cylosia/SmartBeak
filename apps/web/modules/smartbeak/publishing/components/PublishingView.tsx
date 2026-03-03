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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@repo/ui/components/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { toast, toastError } from "@repo/ui/components/toast";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  SendIcon,
  PlusIcon,
  ActivityIcon,
  GlobeIcon,
  MailIcon,
  LinkedinIcon,
  Loader2Icon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const PUBLISH_TARGETS = [
  { value: "web", label: "Web (Site)", icon: GlobeIcon },
  { value: "email", label: "Email (Resend)", icon: MailIcon },
  { value: "linkedin", label: "LinkedIn", icon: LinkedinIcon },
  { value: "facebook", label: "Facebook", icon: ActivityIcon },
  { value: "instagram", label: "Instagram", icon: ActivityIcon },
  { value: "youtube", label: "YouTube", icon: ActivityIcon },
  { value: "wordpress", label: "WordPress", icon: ActivityIcon },
  { value: "tiktok", label: "TikTok", icon: ActivityIcon },
  { value: "pinterest", label: "Pinterest", icon: ActivityIcon },
  { value: "vimeo", label: "Vimeo", icon: ActivityIcon },
  { value: "soundcloud", label: "SoundCloud", icon: ActivityIcon },
] as const;

export function PublishingView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("web");
  const [selectedContentId, setSelectedContentId] = useState<string>("");
  const queryClient = useQueryClient();

  const contentQuery = useQuery(
    orpc.smartbeak.content.list.queryOptions({
      input: { organizationSlug, domainId, limit: 100, offset: 0 },
    }),
  );

  const jobsQuery = useQuery(
    orpc.smartbeak.publishing.listJobs.queryOptions({
      input: { organizationSlug, domainId, limit: 50, offset: 0 },
    }),
  );

  const createMutation = useMutation(
    orpc.smartbeak.publishing.createJob.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.publishing.listJobs.key(),
        });
        toast({ title: "Publishing job queued" });
        setOpen(false);
      },
      onError: (err) => {
        toastError("Error", err.message);
      },
    }),
  );

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {(jobsQuery.data?.items ?? []).length} publishing jobs
          </p>
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            New Job
          </Button>
        </div>

        {/* Jobs Table */}
        {jobsQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-destructive">Failed to load publishing jobs.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => jobsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : jobsQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : (jobsQuery.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={SendIcon}
            title="No publishing jobs"
            description="Create a publishing job to distribute your content across channels."
            action={
              <Button onClick={() => setOpen(true)}>
                <PlusIcon className="mr-2 h-4 w-4" />
                New Job
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobsQuery.data?.items ?? []).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                          <SendIcon className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="font-medium capitalize">{job.target}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status ?? "pending"} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.attemptCount ?? 0} / {job.maxAttempts ?? 3}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.scheduledFor
                        ? formatDistanceToNow(new Date(job.scheduledFor), {
                            addSuffix: true,
                          })
                        : "Immediate"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.createdAt
                        ? formatDistanceToNow(new Date(job.createdAt), {
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

        {/* Create Job Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Publishing Job</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Content Item</label>
                <Select value={selectedContentId} onValueChange={setSelectedContentId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select content to publish" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contentQuery.data?.items ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Publish Target</label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUBLISH_TARGETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    organizationSlug,
                    domainId,
                    contentId: selectedContentId || undefined,
                    target: target as
                      | "web"
                      | "linkedin"
                      | "facebook"
                      | "instagram"
                      | "youtube"
                      | "wordpress"
                      | "email"
                      | "tiktok"
                      | "pinterest"
                      | "vimeo"
                      | "soundcloud",
                  })
                }
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                {createMutation.isPending ? "Queuing..." : "Queue Job"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
