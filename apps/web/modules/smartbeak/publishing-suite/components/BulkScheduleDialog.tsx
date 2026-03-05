"use client";
import type { PublishingSuiteTarget } from "@repo/database";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@repo/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import { PlusIcon, Trash2Icon, CalendarIcon } from "lucide-react";

const PLATFORMS = [
  "web","email","linkedin","facebook","instagram","youtube","tiktok","pinterest","vimeo","soundcloud","wordpress",
] as const;

interface ScheduleRow {
  contentId: string;
  target: string;
  scheduledFor: string;
}

export function BulkScheduleDialog({
  organizationSlug,
  domainId,
  open,
  onClose,
}: {
  organizationSlug: string;
  domainId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ScheduleRow[]>([
    { contentId: "", target: "web", scheduledFor: "" },
  ]);

  const bulkMutation = useMutation(
    orpc.smartbeak.publishingSuite.bulkSchedule.mutationOptions({
      onSuccess: (data) => {
        toastSuccess("Bulk schedule created", `${data.count} publishing jobs scheduled.`);
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite"] });
        onClose();
      },
      onError: (err: unknown) => toastError("Bulk schedule failed", err instanceof Error ? err.message : "Unknown error"),
    }),
  );

  const addRow = () =>
    setRows((r) => [...r, { contentId: "", target: "web", scheduledFor: "" }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<ScheduleRow>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const handleSubmit = () => {
    const valid = rows.filter((r) => r.contentId && r.target && r.scheduledFor);
    if (valid.length === 0) {
      toastError("No valid rows", "Fill in content ID, platform, and date for each row.");
      return;
    }
    bulkMutation.mutate({
      organizationSlug,
      domainId,
      jobs: valid.map((r) => ({
        contentId: r.contentId,
        target: r.target as PublishingSuiteTarget,
        scheduledFor: new Date(r.scheduledFor).toISOString(),
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-blue-500 dark:text-blue-400" />
            Bulk Schedule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_140px_180px_32px] gap-2 text-xs font-medium text-muted-foreground">
            <span>Content ID</span>
            <span>Platform</span>
            <span>Scheduled For</span>
            <span />
          </div>

          {rows.map((row, i) => (
            <div key={`row-${i}`} className="grid grid-cols-[1fr_140px_180px_32px] items-center gap-2">
              <Input
                placeholder="UUID or slug"
                value={row.contentId}
                onChange={(e) => updateRow(i, { contentId: e.target.value })}
                className="h-8 text-xs"
              />
              <Select value={row.target} onValueChange={(v) => updateRow(i, { target: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize text-xs">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="datetime-local"
                value={row.scheduledFor}
                onChange={(e) => updateRow(i, { scheduledFor: e.target.value })}
                className="h-8 text-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addRow} className="h-8 gap-1 text-xs">
            <PlusIcon className="h-3 w-3" /> Add Row
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={bulkMutation.isPending}>
            {bulkMutation.isPending ? "Scheduling…" : `Schedule ${rows.length} Job${rows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
