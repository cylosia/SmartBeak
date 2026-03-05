"use client";

/**
 * Phase 3B — AI Co-Pilot Toolbar
 *
 * A floating toolbar that appears when text is selected in the Tiptap editor,
 * providing quick access to AI co-pilot actions: rewrite, fact-check, optimize,
 * shorten, expand, and tone adjustment.
 *
 * For inline suggestions (Tab-to-complete), the toolbar also shows a
 * "Suggest" button that inserts ghost text after the cursor.
 *
 * Usage:
 *   <AiCopilotToolbar editor={editor} organizationSlug={slug} />
 *
 * The toolbar must be rendered inside the same component tree as the
 * TiptapEditor so it has access to the editor instance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  MinimizeIcon,
  PenIcon,
  SearchIcon,
  SparklesIcon,
  TrendingUpIcon,
  ZoomInIcon,
} from "lucide-react";
import { toastError } from "@repo/ui/components/toast";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Separator } from "@repo/ui/components/separator";
import type { CopilotAction } from "./AiCopilotExtension";

interface AiCopilotToolbarProps {
  editor: Editor | null;
  documentTitle?: string;
}

const ACTION_META: Record<
  CopilotAction,
  { label: string; icon: React.ReactNode; description: string }
> = {
  suggest: {
    label: "Suggest",
    icon: <SparklesIcon className="h-3.5 w-3.5" />,
    description: "Continue writing from cursor",
  },
  rewrite: {
    label: "Rewrite",
    icon: <PenIcon className="h-3.5 w-3.5" />,
    description: "Rewrite for clarity and impact",
  },
  fact_check: {
    label: "Fact Check",
    icon: <CheckCircle2Icon className="h-3.5 w-3.5" />,
    description: "Identify claims to verify",
  },
  optimize: {
    label: "Optimize",
    icon: <TrendingUpIcon className="h-3.5 w-3.5" />,
    description: "Optimize for SEO and readability",
  },
  shorten: {
    label: "Shorten",
    icon: <MinimizeIcon className="h-3.5 w-3.5" />,
    description: "Make more concise",
  },
  expand: {
    label: "Expand",
    icon: <ZoomInIcon className="h-3.5 w-3.5" />,
    description: "Add more detail",
  },
  tone: {
    label: "Tone",
    icon: <SearchIcon className="h-3.5 w-3.5" />,
    description: "Adjust writing tone",
  },
};

const TONE_OPTIONS = [
  "professional",
  "casual",
  "persuasive",
  "academic",
  "friendly",
] as const;

export function AiCopilotToolbar({
  editor,
  documentTitle,
}: AiCopilotToolbarProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<CopilotAction | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Track selection state
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { empty } = editor.state.selection;
      setHasSelection(!empty);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const runAction = useCallback(
    async (action: CopilotAction, targetTone?: string) => {
      if (!editor) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const { from, to, empty } = editor.state.selection;
      const selectedText = empty
        ? editor.getText().slice(Math.max(0, from - 500), from)
        : editor.state.doc.textBetween(from, to, " ");

      const documentContext = editor.getText().slice(0, 3000);

      setIsLoading(true);
      setActiveAction(action);
      setResultText(null);
      setShowResult(false);

      try {
        const response = await fetch("/api/ai/stream/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action,
            selectedText,
            documentContext,
            title: documentTitle,
            targetTone,
          }),
        });

        if (!response.ok) {
          throw new Error(`Request failed: HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setResultText(fullText);
        }

        if (action === "suggest") {
          // For suggestions, insert ghost text
          editor.commands.insertCopilotResult(fullText);
        } else {
          // For other actions, show the result in a popover for review
          setResultText(fullText);
          setShowResult(true);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toastError("Error", "AI co-pilot request failed. Please try again.");
        }
      } finally {
        setIsLoading(false);
        setActiveAction(null);
      }
    },
    [editor, documentTitle],
  );

  const acceptResult = useCallback(() => {
    if (!editor || !resultText) return;
    editor.commands.insertCopilotResult(resultText);
    setShowResult(false);
    setResultText(null);
  }, [editor, resultText]);

  const dismissResult = useCallback(() => {
    setShowResult(false);
    setResultText(null);
    abortRef.current?.abort();
  }, []);

  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Suggest (always available) */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => runAction("suggest")}
        disabled={isLoading}
        title="AI Suggest (Mod+Shift+S)"
      >
        {isLoading && activeAction === "suggest" ? (
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <SparklesIcon className="h-3.5 w-3.5 text-primary" />
        )}
        Suggest
      </Button>

      <Separator orientation="vertical" className="h-4" />

      {/* Selection-based actions */}
      {hasSelection && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => runAction("rewrite")}
            disabled={isLoading}
            title="Rewrite selection (Mod+Shift+R)"
          >
            {isLoading && activeAction === "rewrite" ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PenIcon className="h-3.5 w-3.5" />
            )}
            Rewrite
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => runAction("fact_check")}
            disabled={isLoading}
            title="Fact-check selection (Mod+Shift+F)"
          >
            {isLoading && activeAction === "fact_check" ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2Icon className="h-3.5 w-3.5" />
            )}
            Fact Check
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => runAction("optimize")}
            disabled={isLoading}
            title="Optimize for SEO (Mod+Shift+O)"
          >
            {isLoading && activeAction === "optimize" ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TrendingUpIcon className="h-3.5 w-3.5" />
            )}
            Optimize
          </Button>

          {/* More actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={isLoading}
              >
                More
                <ChevronDownIcon className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs">
                Selection Actions
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onClick={() => runAction("shorten")}
              >
                <MinimizeIcon className="mr-2 h-3.5 w-3.5" />
                Shorten
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onClick={() => runAction("expand")}
              >
                <ZoomInIcon className="mr-2 h-3.5 w-3.5" />
                Expand
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">
                Adjust Tone
              </DropdownMenuLabel>
              {TONE_OPTIONS.map((tone) => (
                <DropdownMenuItem
                  key={tone}
                  className="text-xs capitalize"
                  onClick={() => runAction("tone", tone)}
                >
                  {tone}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Result Popover */}
      {showResult && resultText && (
        <Popover open={showResult} onOpenChange={(open) => !open && dismissResult()}>
          <PopoverTrigger asChild>
            <span />
          </PopoverTrigger>
          <PopoverContent
            className="w-[480px] p-0"
            side="bottom"
            align="start"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <SparklesIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  AI Co-Pilot Result
                </span>
                {activeAction && (
                  <span className="text-xs text-muted-foreground capitalize">
                    · {ACTION_META[activeAction]?.label}
                  </span>
                )}
              </div>
            </div>
            <ScrollArea className="max-h-64">
              <div className="px-4 py-3">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {resultText}
                </p>
              </div>
            </ScrollArea>
            <div className="flex items-center gap-2 px-4 py-3 border-t bg-muted/30">
              <Button size="sm" className="h-7 text-xs" onClick={acceptResult}>
                <CheckCircle2Icon className="mr-1.5 h-3.5 w-3.5" />
                Replace Selection
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={dismissResult}
              >
                Dismiss
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Loading indicator */}
      {isLoading && activeAction && activeAction !== "suggest" && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          <span>{ACTION_META[activeAction]?.label}...</span>
        </div>
      )}
    </div>
  );
}
