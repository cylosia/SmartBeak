"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { orpcClient } from "@shared/lib/orpc-client";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { TiptapEditor } from "./TiptapEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { toast, toastError } from "@repo/ui/components/toast";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { PageSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  ArrowLeftIcon,
  SaveIcon,
  SparklesIcon,
  HistoryIcon,
  SendIcon,
  Loader2Icon,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export function ContentEditorView({
  organizationSlug,
  domainId,
  contentId,
}: {
  organizationSlug: string;
  domainId: string;
  contentId: string;
}) {
  const queryClient = useQueryClient();

  const contentQuery = useQuery(
    orpc.smartbeak.content.get.queryOptions({
      input: { organizationSlug, id: contentId },
    }),
  );

  const [title, setTitle] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [status, setStatus] = useState<string>("draft");
  const [aiIdeas, setAiIdeas] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [ideaInput, setIdeaInput] = useState("");
  const initializedRef = useRef<string | null>(null);

  const item = contentQuery.data?.item;

  useEffect(() => {
    if (item && initializedRef.current !== item.id) {
      initializedRef.current = item.id;
      setTitle(item.title);
      setBody(item.body ?? "");
      setStatus(item.status ?? "draft");
    }
  }, [item]);

  const updateMutation = useMutation(
    orpc.smartbeak.content.update.mutationOptions({
      onMutate: async (variables) => {
        await queryClient.cancelQueries({
          queryKey: orpc.smartbeak.content.get.key(),
        });
        const previous = queryClient.getQueryData(
          orpc.smartbeak.content.get.key({ input: { organizationSlug, id: contentId } }),
        );
        queryClient.setQueryData(
          orpc.smartbeak.content.get.key({ input: { organizationSlug, id: contentId } }),
          (old: unknown) => {
            if (!old || typeof old !== "object") return old;
            const data = old as Record<string, unknown>;
            return {
              ...data,
              item: {
                ...(data.item as Record<string, unknown>),
                title: variables.title ?? (data.item as Record<string, unknown>).title,
                body: variables.body ?? (data.item as Record<string, unknown>).body,
                status: variables.status ?? (data.item as Record<string, unknown>).status,
              },
            };
          },
        );
        return { previous };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.content.get.key(),
        });
        toast({ title: "Saved", description: "Content updated successfully." });
      },
      onError: (err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            orpc.smartbeak.content.get.key({ input: { organizationSlug, id: contentId } }),
            context.previous,
          );
        }
        toastError("Error", err.message);
      },
    }),
  );

  const handleSave = useCallback(() => {
    updateMutation.mutate({
      organizationSlug,
      id: contentId,
      title,
      body,
      status: status as "draft" | "published" | "scheduled" | "archived",
    });
  }, [updateMutation, organizationSlug, contentId, title, body, status]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!item) return;
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, item]);

  const handleGenerateIdeas = async () => {
    if (!ideaInput.trim()) return;
    setAiLoading(true);
    setAiIdeas("");
    try {
      const result = await orpcClient.smartbeak.aiIdeas.generateIdeas({
        organizationSlug,
        domainName: ideaInput,
        count: 5,
      });
      setAiIdeas(result.ideas);
    } catch {
      toastError("AI Error", "Failed to generate ideas.");
    } finally {
      setAiLoading(false);
    }
  };

  if (contentQuery.isLoading) return <PageSkeleton />;
  if (contentQuery.isError) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <p className="text-sm text-destructive">Failed to load content.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => contentQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!item) return <div className="text-muted-foreground py-8 text-center">Content not found.</div>;

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        <Link
          href={`/app/${organizationSlug}/domains/${domainId}/content`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to content
        </Link>

        {/* Editor Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <Select
              value={status}
              onValueChange={(v) => setStatus(v)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {/* Revisions Sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <HistoryIcon className="mr-2 h-4 w-4" />
                  Revisions ({contentQuery.data?.revisions?.length ?? 0})
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Revision History</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  {contentQuery.data?.revisions?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No revisions yet. Save changes to create a revision.
                    </p>
                  ) : (
                    contentQuery.data?.revisions?.map((rev) => (
                      <div
                        key={rev.id}
                        className="rounded-lg border border-border p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Version {rev.version}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {rev.createdAt
                              ? formatDistanceToNow(new Date(rev.createdAt), {
                                  addSuffix: true,
                                })
                              : "—"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {rev.body?.slice(0, 100) ?? "Empty"}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBody(rev.body ?? "");
                            toast({ title: "Revision loaded", description: "Save to apply changes." });
                          }}
                        >
                          Restore
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {/* AI Ideas Sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <SparklesIcon className="mr-2 h-4 w-4" />
                  AI Ideas
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>AI Content Ideas</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enter your domain or niche to generate content ideas.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. SaaS marketing blog"
                      value={ideaInput}
                      onChange={(e) => setIdeaInput(e.target.value)}
                    />
                    <Button
                      size="icon"
                      onClick={handleGenerateIdeas}
                      disabled={aiLoading}
                      aria-label="Generate AI ideas"
                    >
                      {aiLoading ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SendIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {aiIdeas && (
                    <div className="rounded-lg border border-border bg-muted/50 p-3">
                      <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
                        {aiIdeas}
                      </pre>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>

        {/* Editor */}
        <Tabs defaultValue="editor">
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="editor" className="space-y-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title..."
              className="text-xl font-semibold border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
            />
            <TiptapEditor content={body} onChange={setBody} />
          </TabsContent>
          <TabsContent value="preview">
            <Card>
              <CardHeader>
                <CardTitle>{title || "Untitled"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {body ? (
                    <div dangerouslySetInnerHTML={{ __html: body }} />
                  ) : (
                    <p className="text-muted-foreground">No content yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ErrorBoundary>
  );
}
