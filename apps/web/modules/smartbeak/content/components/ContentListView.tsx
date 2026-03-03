"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/toast";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  FileTextIcon,
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { formatDistanceToNow } from "date-fns";

const CreateContentSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
});

type CreateContentForm = z.infer<typeof CreateContentSchema>;

const STATUS_FILTERS = ["all", "draft", "published", "scheduled", "archived"] as const;

export function ContentListView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const contentQuery = useQuery(
    orpc.smartbeak.content.list.queryOptions({
      input: {
        organizationSlug,
        domainId,
        query: search || undefined,
        status:
          statusFilter !== "all"
            ? (statusFilter as "draft" | "published" | "scheduled" | "archived")
            : undefined,
        limit: 50,
        offset: 0,
      },
    }),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateContentForm>({
    resolver: zodResolver(CreateContentSchema),
  });

  const createMutation = useMutation(
    orpc.smartbeak.content.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.content.list.key(),
        });
        toast({ title: "Content created" });
        reset();
        setOpen(false);
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "error" });
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.smartbeak.content.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.content.list.key(),
        });
        toast({ title: "Content deleted" });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "error" });
      },
    }),
  );

  const onSubmit = (data: CreateContentForm) => {
    createMutation.mutate({
      organizationSlug,
      domainId,
      title: data.title,
      status: "draft",
    });
  };

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search content..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-1">
              {STATUS_FILTERS.map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                  className="capitalize"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            New Content
          </Button>
        </div>

        {/* Table */}
        {contentQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : contentQuery.data?.items.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No content yet"
            description="Create your first piece of content for this domain."
            action={
              <Button onClick={() => setOpen(true)}>
                <PlusIcon className="mr-2 h-4 w-4" />
                New Content
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contentQuery.data?.items.map((item) => (
                  <TableRow key={item.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                          <FileTextIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <Link
                          href={`/app/${organizationSlug}/domains/${domainId}/content/${item.id}`}
                          className="font-medium hover:text-primary transition-colors"
                        >
                          {item.title}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status ?? "draft"} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      v{item.version}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.updatedAt
                        ? formatDistanceToNow(new Date(item.updatedAt), {
                            addSuffix: true,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/app/${organizationSlug}/domains/${domainId}/content/${item.id}`}
                            >
                              <PencilIcon className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              deleteMutation.mutate({
                                organizationSlug,
                                id: item.id,
                              })
                            }
                          >
                            <TrashIcon className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Create Content Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Content</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input
                  {...register("title")}
                  placeholder="My Article Title"
                  className="mt-1"
                />
                {errors.title && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.title.message}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
