"use client";

/**
 * Phase 3B — Agent Management Dashboard
 *
 * Lists all AI agents for an organization, allows creating new agents,
 * editing configurations, and seeding the three default agents.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";
import { orpc } from "@shared/lib/orpc-query-utils";

interface AgentManagementDashboardProps {
  organizationSlug: string;
}

const AGENT_TYPE_META: Record<
  string,
  { label: string; icon: React.ReactNode; description: string; color: string }
> = {
  research: {
    label: "Research",
    icon: <ZapIcon className="h-4 w-4" />,
    description: "Searches the web and synthesizes information into research briefs.",
    color: "bg-blue-500/10 border-blue-500/30 dark:bg-blue-950/40 dark:border-blue-800",
  },
  writer: {
    label: "Writer",
    icon: <SparklesIcon className="h-4 w-4" />,
    description: "Transforms research into compelling, SEO-optimized content.",
    color: "bg-purple-500/10 border-purple-500/30 dark:bg-purple-950/40 dark:border-purple-800",
  },
  editor: {
    label: "Editor",
    icon: <CheckCircle2Icon className="h-4 w-4" />,
    description: "Reviews and improves content for clarity, accuracy, and flow.",
    color: "bg-green-500/10 border-green-500/30 dark:bg-green-950/40 dark:border-green-800",
  },
  custom: {
    label: "Custom",
    icon: <BotIcon className="h-4 w-4" />,
    description: "A fully customizable agent for any task.",
    color: "bg-orange-500/10 border-orange-500/30 dark:bg-orange-950/40 dark:border-orange-800",
  },
};

const AVAILABLE_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (fast, cheap)" },
  { value: "gpt-4o", label: "GPT-4o (powerful)" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (best quality)" },
  { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku (fast)" },
];

export function AgentManagementDashboard({
  organizationSlug,
}: AgentManagementDashboardProps) {
  const queryClient = useQueryClient();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    agentType: "custom",
    model: "gpt-4o-mini",
    systemPrompt: "",
    temperature: "0.7",
    maxTokens: "4096",
  });

  const agentsQuery = useQuery(
    orpc.aiAgents.listAgents.queryOptions({
      input: { organizationSlug },
    }),
  );

  const seedMutation = useMutation({
    ...orpc.aiAgents.seedDefaultAgents.mutationOptions(),
    onSuccess: (data) => {
      if ((data as { seeded: boolean }).seeded) {
        toastSuccess("Default agents created: Research, Writer, and Editor.");
      } else {
        toastSuccess("Agents already exist", "Agents already exist for this organization.");
      }
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
    },
    onError: () => toastError("Error", "Failed to seed default agents."),
  });

  const createMutation = useMutation({
    ...orpc.aiAgents.createAgent.mutationOptions(),
    onSuccess: () => {
      toastSuccess("Agent created successfully.");
      setShowCreateDialog(false);
      setForm({
        name: "",
        description: "",
        agentType: "custom",
        model: "gpt-4o-mini",
        systemPrompt: "",
        temperature: "0.7",
        maxTokens: "4096",
      });
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
    },
    onError: () => toastError("Error", "Failed to create agent."),
  });

  const toggleMutation = useMutation({
    ...orpc.aiAgents.updateAgent.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
    },
    onError: () => toastError("Error", "Failed to update agent."),
  });

  const deleteMutation = useMutation({
    ...orpc.aiAgents.deleteAgent.mutationOptions(),
    onSuccess: () => {
      toastSuccess("Agent deleted.");
      queryClient.invalidateQueries({ queryKey: ["aiAgents"] });
    },
    onError: () => toastError("Error", "Failed to delete agent."),
  });

  const agents = (agentsQuery.data as unknown as { agents: Array<{
    id: string;
    name: string;
    description: string | null;
    agentType: string;
    isActive: boolean;
    config: { model?: string; temperature?: number; maxTokens?: number };
    createdAt: Date | string;
  }> } | undefined)?.agents ?? [];

  const handleCreate = () => {
    createMutation.mutate({
      organizationSlug,
      name: form.name,
      description: form.description || undefined,
      agentType: form.agentType as "research" | "writer" | "editor" | "custom",
      config: {
        model: form.model,
        temperature: Number(form.temperature) || 0.7,
        maxTokens: Number(form.maxTokens) || 4096,
        systemPrompt: form.systemPrompt || undefined,
        tools: form.agentType === "research"
          ? ["web_search", "read_url", "fact_check"]
          : form.agentType === "editor"
          ? ["fact_check"]
          : [],
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">AI Agents</h2>
          <p className="text-sm text-muted-foreground">
            Manage the AI agents that power your workflows.
          </p>
        </div>
        <div className="flex gap-2">
          {agents.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedMutation.mutate({ organizationSlug })}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SparklesIcon className="mr-2 h-4 w-4" />
              )}
              Seed Default Agents
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            New Agent
          </Button>
        </div>
      </div>

      {/* Agent Grid */}
      {agentsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : agentsQuery.isError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 py-20 text-muted-foreground gap-4">
          <AlertTriangleIcon className="h-12 w-12 text-destructive opacity-60" />
          <div className="text-center">
            <p className="font-medium text-destructive">Failed to load agents</p>
            <p className="text-sm mt-1">
              {agentsQuery.error?.message ?? "An unexpected error occurred."}
            </p>
          </div>
          <Button variant="outline" onClick={() => agentsQuery.refetch()}>
            Try Again
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-muted-foreground gap-4">
          <BotIcon className="h-12 w-12 opacity-20" />
          <div className="text-center">
            <p className="font-medium">No agents yet</p>
            <p className="text-sm mt-1">
              Seed the three default agents or create a custom one.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => seedMutation.mutate({ organizationSlug })}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending ? (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <SparklesIcon className="mr-2 h-4 w-4" />
            )}
            Seed Default Agents
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const meta = AGENT_TYPE_META[agent.agentType] ?? AGENT_TYPE_META.custom;
            return (
              <Card
                key={agent.id}
                className={`border-2 ${meta.color} transition-shadow hover:shadow-md`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-background/80 p-2">
                        {meta.icon}
                      </div>
                      <div>
                        <CardTitle className="text-sm">{agent.name}</CardTitle>
                        <Badge status="info" className="text-xs mt-0.5 capitalize">
                          {meta.label}
                        </Badge>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Agent actions">
                          <MoreHorizontalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            toggleMutation.mutate({
                              organizationSlug,
                              agentId: agent.id,
                              isActive: !agent.isActive,
                            })
                          }
                        >
                          {agent.isActive ? "Deactivate" : "Activate"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() =>
                            deleteMutation.mutate({
                              organizationSlug,
                              agentId: agent.id,
                            })
                          }
                        >
                          <Trash2Icon className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CardDescription className="text-xs line-clamp-2">
                    {agent.description ?? meta.description}
                  </CardDescription>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{agent.config?.model ?? "gpt-4o-mini"}</span>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={agent.isActive}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({
                            organizationSlug,
                            agentId: agent.id,
                            isActive: checked,
                          })
                        }
                        className="scale-75"
                      />
                      <span>{agent.isActive ? "Active" : "Inactive"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Agent Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Agent</DialogTitle>
            <DialogDescription>
              Configure a new AI agent for your workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  placeholder="My Agent"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-type">Type</Label>
                <Select
                  value={form.agentType}
                  onValueChange={(v) => setForm((f) => ({ ...f, agentType: v }))}
                >
                  <SelectTrigger id="agent-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AGENT_TYPE_META).map(([value, meta]) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex items-center gap-2">
                          {meta.icon}
                          {meta.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-desc">Description</Label>
              <Input
                id="agent-desc"
                placeholder="What does this agent do?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model</Label>
              <Select
                value={form.model}
                onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}
              >
                <SelectTrigger id="agent-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-prompt">System Prompt (optional)</Label>
              <Textarea
                id="agent-prompt"
                placeholder="You are an expert..."
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                rows={4}
                className="resize-none text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-temp">Temperature</Label>
                <Input
                  id="agent-temp"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-tokens">Max Tokens</Label>
                <Input
                  id="agent-tokens"
                  type="number"
                  min="256"
                  max="32768"
                  step="256"
                  value={form.maxTokens}
                  onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!form.name || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
