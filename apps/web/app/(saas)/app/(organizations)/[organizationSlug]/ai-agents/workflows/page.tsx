"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import { useRouter } from "next/navigation";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Textarea } from "@repo/ui/components/textarea";
import { orpc } from "@shared/lib/orpc-query-utils";

interface WorkflowsPageProps {
  params: Promise<{ organizationSlug: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30 dark:text-yellow-400",
  active: "bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400",
  archived: "bg-muted text-muted-foreground",
};

export default function WorkflowsPage({ params }: WorkflowsPageProps) {
  const { organizationSlug } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const workflowsQuery = useQuery(
    orpc.aiAgents.listWorkflows.queryOptions({
      input: { organizationSlug },
    }),
  );

  const createMutation = useMutation({
    ...orpc.aiAgents.createWorkflow.mutationOptions(),
    onSuccess: (data: { workflow: { id: string } }) => {
      toastSuccess("Workflow created.");
      setShowCreate(false);
      setForm({ name: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
      router.push(`/app/${organizationSlug}/ai-agents/workflows/${data.workflow.id}`);
    },
    onError: () => toastError("Error", "Failed to create workflow."),
  });

  const deleteMutation = useMutation({
    ...orpc.aiAgents.deleteWorkflow.mutationOptions(),
    onSuccess: () => {
      toastSuccess("Workflow deleted.");
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
    },
    onError: () => toastError("Error", "Failed to delete workflow."),
  });

  const workflows = (workflowsQuery.data as { workflows: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
    stepsJson: { nodes: unknown[] };
  }> })?.workflows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Build and run multi-agent workflows.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <PlusIcon className="mr-2 h-4 w-4" />
          New Workflow
        </Button>
      </div>

      {workflowsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-muted-foreground gap-4">
          <LayoutIcon className="h-12 w-12 opacity-20" />
          <div className="text-center">
            <p className="font-medium">No workflows yet</p>
            <p className="text-sm mt-1">
              Create a workflow to chain agents together.
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowCreate(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            Create Workflow
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => (
            <Card
              key={wf.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                router.push(
                  `/app/${organizationSlug}/ai-agents/workflows/${wf.id}`,
                )
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <LayoutIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">{wf.name}</CardTitle>
                      <Badge
                        className={`text-xs mt-0.5 capitalize border ${STATUS_COLORS[wf.status] ?? ""}`}
                      >
                        {wf.status}
                      </Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/app/${organizationSlug}/ai-agents/workflows/${wf.id}`,
                          );
                        }}
                      >
                        <PlayIcon className="mr-2 h-4 w-4" />
                        Open Builder
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate({
                            organizationSlug,
                            workflowId: wf.id,
                          });
                        }}
                      >
                        <Trash2Icon className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs line-clamp-2">
                  {wf.description ?? "No description provided."}
                </CardDescription>
                <p className="text-xs text-muted-foreground mt-2">
                  {(wf.stepsJson?.nodes?.length ?? 0)} agent
                  {(wf.stepsJson?.nodes?.length ?? 0) !== 1 ? "s" : ""} ·{" "}
                  {new Date(wf.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Workflow Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Workflow</DialogTitle>
            <DialogDescription>
              Give your workflow a name and description. You can add agents in the builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                placeholder="Content Creation Pipeline"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description</Label>
              <Textarea
                id="wf-desc"
                placeholder="What does this workflow do?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  organizationSlug,
                  name: form.name,
                  description: form.description || undefined,
                  stepsJson: { nodes: [], edges: [] },
                })
              }
              disabled={!form.name || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
