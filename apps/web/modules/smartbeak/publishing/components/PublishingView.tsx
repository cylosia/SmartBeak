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
import { toast } from "@repo/ui/components/toast";
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
  const queryClient = useQueryClient();

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
        toast({ title: "Error", description: err.message, variant: "error" });
      },
    }),
  );

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {jobsQuery.data?.jobs.length ?? 0} publishing jobs
          </p>
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            New Job
          </Button>
        </div>

        {/* Jobs Table */}
        {jobsQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : jobsQuery.data?.jobs.length === 0 ? (
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
                {jobsQuery.data?.jobs.map((job) => (
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
                {createMutation.isPending ? "Queuing..." : "Queue Job"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
