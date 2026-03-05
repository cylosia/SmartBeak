"use client";

import type { ChangeEvent } from "react";
import { orpc } from "@/modules/smartbeak/shared/lib/api";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { toastError } from "@repo/ui/components/toast";
import {
  BookOpenIcon,
  CheckIcon,
  ClipboardCopyIcon,
  ClockIcon,
  SparklesIcon,
  TagIcon,
} from "lucide-react";
import { useState } from "react";

interface Props {
  organizationSlug: string;
  domainId: string;
  onClose: () => void;
}

type Idea = {
  title: string;
  metaDescription: string;
  outline: string[];
  targetKeywords: string[];
  contentType: string;
  estimatedReadTime: number;
  seoScore: number;
  difficulty: "easy" | "medium" | "hard";
};

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const map: Record<string, string> = {
    easy: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    hard: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  };
  return (
    <Badge className={`text-xs capitalize ${map[difficulty] ?? ""}`}>
      {difficulty}
    </Badge>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : score >= 40
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
        : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
  return (
    <Badge className={`text-xs ${color}`}>
      SEO {score}/100
    </Badge>
  );
}

function IdeaCard({ idea, index }: { idea: Idea; index: number }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    const text = `# ${idea.title}\n\n${idea.metaDescription}\n\n## Outline\n${(idea.outline ?? []).map((h) => `- ${h}`).join("\n")}\n\nKeywords: ${(idea.targetKeywords ?? []).join(", ")}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toastError("Copy failed", "Could not copy to clipboard.");
    });
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-muted-foreground">
                #{index + 1}
              </span>
              <Badge className="border border-border text-xs capitalize">
                {idea.contentType}
              </Badge>
            </div>
            <CardTitle className="text-base leading-snug">{idea.title}</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7"
            onClick={copyToClipboard}
            aria-label="Copy idea to clipboard"
          >
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <ClipboardCopyIcon className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          {idea.metaDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Outline */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
            <BookOpenIcon className="h-3.5 w-3.5" />
            Outline
          </p>
          <ul className="space-y-1">
            {(idea.outline ?? []).map((h, i) => (
              <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <span className="text-muted-foreground mt-0.5">—</span>
                {h}
              </li>
            ))}
          </ul>
        </div>

        {/* Keywords */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
            <TagIcon className="h-3.5 w-3.5" />
            Target Keywords
          </p>
          <div className="flex flex-wrap gap-1">
            {(idea.targetKeywords ?? []).map((kw) => (
              <Badge key={kw} className="bg-muted text-muted-foreground text-xs">
                {kw}
              </Badge>
            ))}
          </div>
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="h-3.5 w-3.5" />
            {idea.estimatedReadTime} min read
          </div>
          <ScoreBadge score={idea.seoScore} />
          <DifficultyBadge difficulty={idea.difficulty} />
        </div>
      </CardContent>
    </Card>
  );
}

export function AiIdeaPanel({ organizationSlug, domainId, onClose }: Props) {
  const [niche, setNiche] = useState("");
  const [count, setCount] = useState("5");
  const [contentType, setContentType] = useState<
    "any" | "article" | "listicle" | "guide" | "case-study" | "comparison"
  >("any");
  const [ideas, setIdeas] = useState<Idea[]>([]);

  const generateMutation = useMutation(
    orpc.smartbeak.seoIntelligence.generateAiIdeas.mutationOptions({
      onSuccess: (data) => {
        setIdeas(data.ideas as Idea[]);
      },
      onError: (err) => {
        toastError("Generation failed", err.message ?? "Please try again.");
      },
    }),
  );

  return (
    <Sheet open onOpenChange={(open: boolean) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
      >
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-violet-500" />
            AI Content Idea Generator
          </SheetTitle>
          <SheetDescription>
            Generate SEO-optimized content ideas with outlines, keyword targets,
            and SEO scores — powered by the Vercel AI SDK.
          </SheetDescription>
        </SheetHeader>

        {/* Config form */}
        <div className="space-y-4 mb-6 p-4 rounded-xl border border-border bg-muted/30">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Niche / Topic (optional)</Label>
              <Input
                placeholder="e.g. B2B SaaS, e-commerce..."
                value={niche}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNiche(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Content Type</Label>
              <Select
                value={contentType}
                onValueChange={(v: string) => setContentType(v as typeof contentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any format</SelectItem>
                  <SelectItem value="article">Article</SelectItem>
                  <SelectItem value="listicle">Listicle</SelectItem>
                  <SelectItem value="guide">Guide</SelectItem>
                  <SelectItem value="case-study">Case Study</SelectItem>
                  <SelectItem value="comparison">Comparison</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Number of Ideas</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 7, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} ideas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
            onClick={() =>
              generateMutation.mutate({
                organizationSlug,
                domainId,
                niche: niche || undefined,
                contentType,
                count: Number(count) || 5,
              })
            }
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <>
                <SparklesIcon className="mr-2 h-4 w-4 animate-pulse" />
                Generating ideas...
              </>
            ) : (
              <>
                <SparklesIcon className="mr-2 h-4 w-4" />
                Generate Ideas
              </>
            )}
          </Button>
        </div>

        {/* Results */}
        {ideas.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">
              {ideas.length} ideas generated
            </p>
            {ideas.map((idea, i) => (
              <IdeaCard key={`idea-${idea.title.slice(0, 20)}-${i}`} idea={idea} index={i} />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
