"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Badge } from "@repo/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Separator } from "@repo/ui/components/separator";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton as LoadingSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import {
  ActivityIcon,
  AlertTriangleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const createTeamSchema = z.object({
  name: z.string().min(1, "Team name is required").max(100),
  description: z.string().max(500).optional(),
});

type CreateTeamForm = z.infer<typeof createTeamSchema>;

interface TeamManagementDashboardProps {
  organizationSlug: string;
}

export function TeamManagementDashboard({
  organizationSlug,
}: TeamManagementDashboardProps) {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState<"admin" | "member">("member");
  const [activeTab, setActiveTab] = useState<"members" | "activity">("members");

  const teamsQuery = useQuery(
    orpc.enterprise.teams.list.queryOptions({
      input: { organizationSlug },
    }),
  );

  const selectedTeam = teamsQuery.data?.teams.find(
    (t) => t.id === selectedTeamId,
  ) ?? teamsQuery.data?.teams[0] ?? null;

  const effectiveTeamId = selectedTeam?.id ?? null;

  const membersQuery = useQuery({
    ...orpc.enterprise.teams.members.list.queryOptions({
      input: { organizationSlug, teamId: effectiveTeamId ?? "" },
    }),
    enabled: !!effectiveTeamId,
  });

  const activityQuery = useQuery({
    ...orpc.enterprise.teams.activity.queryOptions({
      input: { organizationSlug, teamId: effectiveTeamId ?? "", limit: 50, offset: 0 },
    }),
    enabled: !!effectiveTeamId && activeTab === "activity",
  });

  const form = useForm<CreateTeamForm>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: "", description: "" },
  });

  const createTeamMutation = useMutation(
    orpc.enterprise.teams.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.teams.list.key({ input: { organizationSlug } }),
        });
        setCreateDialogOpen(false);
        form.reset();
        toastSuccess("Team created successfully.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const deleteTeamMutation = useMutation(
    orpc.enterprise.teams.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.teams.list.key({ input: { organizationSlug } }),
        });
        setSelectedTeamId(null);
        toastSuccess("Team deleted.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const addMemberMutation = useMutation(
    orpc.enterprise.teams.members.add.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.teams.members.list.key({
            input: { organizationSlug, teamId: effectiveTeamId ?? "" },
          }),
        });
        setAddMemberDialogOpen(false);
        setAddMemberUserId("");
        toastSuccess("Member added to team.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const removeMemberMutation = useMutation(
    orpc.enterprise.teams.members.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.teams.members.list.key({
            input: { organizationSlug, teamId: effectiveTeamId ?? "" },
          }),
        });
        toastSuccess("Member removed from team.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const updateRoleMutation = useMutation(
    orpc.enterprise.teams.members.updateRole.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.teams.members.list.key({
            input: { organizationSlug, teamId: effectiveTeamId ?? "" },
          }),
        });
        toastSuccess("Role updated.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  return (
    <ErrorBoundary>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Team List Sidebar */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Teams</CardTitle>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="Add">
                    <PlusIcon className="size-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Team</DialogTitle>
                    <DialogDescription>
                      Create a new workspace team with granular permissions.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={form.handleSubmit((data) =>
                      createTeamMutation.mutate({ organizationSlug, ...data }),
                    )}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="team-name">Team Name</Label>
                      <Input
                        id="team-name"
                        placeholder="e.g. Engineering, Marketing"
                        {...form.register("name")}
                      />
                      {form.formState.errors.name && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.name.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="team-desc">Description (optional)</Label>
                      <Textarea
                        id="team-desc"
                        placeholder="What does this team work on?"
                        rows={3}
                        {...form.register("description")}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCreateDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createTeamMutation.isPending}
                      >
                        {createTeamMutation.isPending ? "Creating…" : "Create Team"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {teamsQuery.isLoading ? (
              <div className="p-4">
                <LoadingSkeleton rows={4} />
              </div>
            ) : teamsQuery.isError ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 py-16 gap-3 mx-4">
                <AlertTriangleIcon className="h-10 w-10 text-destructive opacity-60" />
                <div className="text-center">
                  <p className="font-medium text-destructive text-sm">Failed to load teams</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {teamsQuery.error?.message ?? "An unexpected error occurred."}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => teamsQuery.refetch()}>
                  Try Again
                </Button>
              </div>
            ) : (teamsQuery.data?.teams ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                <UsersIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No teams yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create first team
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-72">
                <div className="space-y-1 p-2">
                  {(teamsQuery.data?.teams ?? []).map((team) => (
                    <button
                      key={team.id}
                      onClick={() => setSelectedTeamId(team.id)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        selectedTeam?.id === team.id
                          ? "bg-muted font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{team.name}</span>
                        <Badge status="info" className="ml-2 text-xs">
                          {team.members?.length ?? 0}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Team Detail Panel */}
        <Card className="lg:col-span-3">
          {!selectedTeam ? (
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <UsersIcon className="size-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Select a team to manage its members and activity.
              </p>
            </CardContent>
          ) : (
            <>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{selectedTeam.name}</CardTitle>
                    {selectedTeam.description && (
                      <CardDescription className="mt-1">
                        {selectedTeam.description}
                      </CardDescription>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="More options">
                        <MoreHorizontalIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() =>
                          deleteTeamMutation.mutate({
                            organizationSlug,
                            teamId: selectedTeam.id,
                          })
                        }
                      >
                        <Trash2Icon className="size-4 mr-2" />
                        Delete Team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "members" | "activity")}
              >
                <div className="px-6">
                  <TabsList>
                    <TabsTrigger value="members" className="gap-2">
                      <UserIcon className="size-3.5" />
                      Members
                    </TabsTrigger>
                    <TabsTrigger value="activity" className="gap-2">
                      <ActivityIcon className="size-3.5" />
                      Activity
                    </TabsTrigger>
                  </TabsList>
                </div>

                <Separator className="mt-4" />

                <TabsContent value="members" className="p-0">
                  <div className="flex items-center justify-between px-6 py-3">
                    <p className="text-sm text-muted-foreground">
                      {(membersQuery.data?.members ?? []).length} member
                      {(membersQuery.data?.members ?? []).length !== 1 ? "s" : ""}
                    </p>
                    <Dialog
                      open={addMemberDialogOpen}
                      onOpenChange={setAddMemberDialogOpen}
                    >
                      <DialogTrigger asChild>
                        <Button size="sm" className="gap-2">
                          <PlusIcon className="size-3.5" />
                          Add Member
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add Team Member</DialogTitle>
                          <DialogDescription>
                            Add an organization member to this team with a specific role.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>User ID</Label>
                            <Input
                              placeholder="User ID"
                              value={addMemberUserId}
                              onChange={(e) => setAddMemberUserId(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Role</Label>
                            <Select
                              value={addMemberRole}
                              onValueChange={(v) =>
                                setAddMemberRole(v as "admin" | "member")
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="member">Member</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setAddMemberDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={() =>
                              addMemberMutation.mutate({
                                organizationSlug,
                                teamId: selectedTeam.id,
                                userId: addMemberUserId,
                                role: addMemberRole,
                              })
                            }
                            disabled={
                              !addMemberUserId || addMemberMutation.isPending
                            }
                          >
                            {addMemberMutation.isPending ? "Adding…" : "Add Member"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  {membersQuery.isLoading ? (
                    <div className="px-6 pb-6">
                      <LoadingSkeleton rows={3} />
                    </div>
                  ) : membersQuery.isError ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 py-16 gap-3 mx-6">
                      <AlertTriangleIcon className="h-10 w-10 text-destructive opacity-60" />
                      <div className="text-center">
                        <p className="font-medium text-destructive text-sm">Failed to load members</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {membersQuery.error?.message ?? "An unexpected error occurred."}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => membersQuery.refetch()}>
                        Try Again
                      </Button>
                    </div>
                  ) : (membersQuery.data?.members ?? []).length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <UserIcon className="size-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No members in this team yet.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User ID</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Joined</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(membersQuery.data?.members ?? []).map((member) => (
                          <TableRow key={member.id}>
                            <TableCell className="font-mono text-xs">
                              {member.userId.slice(0, 16)}…
                            </TableCell>
                            <TableCell>
                              <Badge
                                status={member.role === "admin" ? "warning" : "info"}
                                className="gap-1"
                              >
                                {member.role === "admin" && (
                                  <ShieldIcon className="size-3" />
                                )}
                                {member.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(member.createdAt), {
                                addSuffix: true,
                              })}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-7" aria-label="More options">
                                    <MoreHorizontalIcon className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() =>
                                      updateRoleMutation.mutate({
                                        organizationSlug,
                                        teamId: selectedTeam.id,
                                        userId: member.userId,
                                        role:
                                          member.role === "admin"
                                            ? "member"
                                            : "admin",
                                      })
                                    }
                                  >
                                    <ShieldIcon className="size-4 mr-2" />
                                    Make {member.role === "admin" ? "Member" : "Admin"}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() =>
                                      removeMemberMutation.mutate({
                                        organizationSlug,
                                        teamId: selectedTeam.id,
                                        userId: member.userId,
                                      })
                                    }
                                  >
                                    <Trash2Icon className="size-4 mr-2" />
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="p-0">
                  {activityQuery.isLoading ? (
                    <div className="px-6 py-4">
                      <LoadingSkeleton rows={5} />
                    </div>
                  ) : activityQuery.isError ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 py-16 gap-3 mx-6">
                      <AlertTriangleIcon className="h-10 w-10 text-destructive opacity-60" />
                      <div className="text-center">
                        <p className="font-medium text-destructive text-sm">Failed to load activity</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {activityQuery.error?.message ?? "An unexpected error occurred."}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => activityQuery.refetch()}>
                        Try Again
                      </Button>
                    </div>
                  ) : (activityQuery.data?.activity ?? []).length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <ActivityIcon className="size-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No activity recorded yet.
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-72">
                      <div className="divide-y">
                        {(activityQuery.data?.activity ?? []).map((event) => (
                          <div
                            key={event.id}
                            className="flex items-start gap-3 px-6 py-3"
                          >
                            <div className="mt-0.5 size-2 rounded-full bg-primary/60 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{event.action}</p>
                              {event.entityType && (
                                <p className="text-xs text-muted-foreground">
                                  {event.entityType} · {event.entityId?.slice(0, 8)}
                                </p>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(new Date(event.createdAt), {
                                addSuffix: true,
                              })}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </Card>
      </div>
    </ErrorBoundary>
  );
}
