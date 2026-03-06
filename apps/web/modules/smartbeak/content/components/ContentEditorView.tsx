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
import { toastSuccess, toastError } from "@repo/ui/components/toast";
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
  BarChart3Icon,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AiIdeaCard, AiIdeaCardSkeleton } from "./AiIdeaCard";
import { ContentSeoSidebar } from "./ContentSeoSidebar";

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
  const [aiIdeas, setAiIdeas] = useState<Array<{
    title: string;
    outline: string;
    keywords: string[];
    contentType: string;
    estimatedReadTime: number;
    seoScore: number;
  }>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [ideaInput, setIdeaInput] = useState("");
  const [ideaCount, setIdeaCount] = useState("5");
  const [seoSidebarOpen, setSeoSidebarOpen] = useState(false);
  const initializedRef = useRef<string | null>(null);

  const item = contentQuery.data?.item;

  useEffect(() => {
    if (!item) return;
    if (initializedRef.current !== item.id) {
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
        toastSuccess("Saved", "Content updated successfully.");
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
    setAiIdeas([]);
    try {
      const result = await orpcClient.smartbeak.aiIdeas.generateIdeas({
        organizationSlug,
        domainName: ideaInput,
        count: Number(ideaCount) || 5,
      });
      const structured = (result as { structured?: Array<{
        title: string;
        outline: string;
        keywords: string[];
        contentType: string;
        estimatedReadTime: number;
        seoScore: number;
      }> }).structured;
      if (structured && structured.length > 0) {
        setAiIdeas(structured);
      } else {
        try {
          const parsed = JSON.parse(result.ideas);
          setAiIdeas(Array.isArray(parsed) ? parsed : []);
        } catch {
          setAiIdeas([]);
          toastError("AI Error", "Could not parse AI response.");
        }
      }
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
                  {(contentQuery.data?.revisions ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No revisions yet. Save changes to create a revision.
                    </p>
                  ) : (
                    (contentQuery.data?.revisions ?? []).map((rev) => (
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
                            toastSuccess("Revision loaded", "Save to apply changes.");
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
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter your domain or niche to generate content ideas.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. SaaS marketing blog"
                      value={ideaInput}
                      onChange={(e) => setIdeaInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGenerateIdeas();
                      }}
                      className="flex-1"
                    />
                    <Select value={ideaCount} onValueChange={setIdeaCount}>
                      <SelectTrigger className="w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                      </SelectContent>
                    </Select>
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

                  {aiLoading && (
                    <div className="space-y-3">
                      <AiIdeaCardSkeleton />
                      <AiIdeaCardSkeleton />
                      <AiIdeaCardSkeleton />
                    </div>
                  )}

                  {!aiLoading && aiIdeas.length > 0 && (
                    <div className="space-y-3">
                      {aiIdeas.map((idea) => (
                        <AiIdeaCard
                          key={idea.title}
                          idea={idea}
                          onUseTitle={(t) => {
                            setTitle(t);
                            toastSuccess("Title set", t);
                          }}
                        />
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handleGenerateIdeas}
                        disabled={aiLoading}
                      >
                        <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                        Generate More
                      </Button>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant={seoSidebarOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSeoSidebarOpen((v) => !v)}
            >
              <BarChart3Icon className="mr-2 h-4 w-4" />
              SEO
            </Button>

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

        {/* Editor + SEO Sidebar */}
        <div className="flex gap-0">
          <div className="flex-1 min-w-0">
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
          <ContentSeoSidebar
            html={body}
            isOpen={seoSidebarOpen}
            onClose={() => setSeoSidebarOpen(false)}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}
