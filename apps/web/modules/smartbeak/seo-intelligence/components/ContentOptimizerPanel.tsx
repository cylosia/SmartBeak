"use client";

import { orpc } from "@/modules/smartbeak/shared/lib/api";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Progress } from "@repo/ui/components/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { Textarea } from "@repo/ui/components/textarea";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  TagIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  organizationSlug: string;
  domainId: string;
  onClose: () => void;
}

type Suggestion = {
  type: string;
  severity: "info" | "warning" | "error";
  message: string;
};

type OptimizerResult = {
  overallScore: number;
  titleScore: number;
  bodyScore: number;
  keywordScore: number;
  readabilityScore: number;
  metaScore: number;
  wordCount: number;
  estimatedReadTime: number;
  suggestions: Suggestion[];
  keywordDensity: Record<string, number>;
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "error")
    return <AlertCircleIcon className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  if (severity === "warning")
    return <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <InfoIcon className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
}

function ScoreBar({
  label,
  score,
  max,
}: {
  label: string;
  score: number;
  max: number;
}) {
  const pct = Math.round((score / max) * 100);
  const color =
    pct >= 70
      ? "bg-emerald-500"
      : pct >= 40
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {score}/{max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ContentOptimizerPanel({
  organizationSlug,
  domainId,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const optimizeMutation = useMutation(
    orpc.smartbeak.seoIntelligence.optimizeContent.mutationOptions({
      onSuccess: (data) => {
        setResult(data as OptimizerResult);
      },
    }),
  );

  const runOptimizer = useCallback(
    (
      t: string,
      b: string,
      meta: string,
      kwInput: string,
    ) => {
      const keywords = kwInput
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      optimizeMutation.mutate({
        title: t,
        body: b,
        metaDescription: meta || undefined,
        targetKeywords: keywords.length > 0 ? keywords : undefined,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Debounced live scoring
  useEffect(() => {
    if (!title && !body) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runOptimizer(title, body, metaDescription, keywordsInput);
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [title, body, metaDescription, keywordsInput, runOptimizer]);

  const score = result?.overallScore ?? 0;
  const scoreColor =
    score >= 70
      ? "text-emerald-500"
      : score >= 40
        ? "text-amber-500"
        : "text-red-500";

  return (
    <Sheet open onOpenChange={(open: boolean) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl overflow-y-auto"
      >
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <ZapIcon className="h-5 w-5 text-amber-500" />
            Real-time Content Optimizer
          </SheetTitle>
          <SheetDescription>
            Paste or type your content below. SEO scores update live as you
            type — no save required.
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input side */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                placeholder="Your article title..."
                value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              />
              {title && (
                <p
                  className={`text-xs ${title.length > 70 ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {title.length}/70 characters
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Meta Description</Label>
              <Input
                placeholder="Brief description for search engines..."
                value={metaDescription}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetaDescription(e.target.value)}
              />
              {metaDescription && (
                <p
                  className={`text-xs ${metaDescription.length > 160 ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {metaDescription.length}/160 characters
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <TagIcon className="h-3.5 w-3.5" />
                Target Keywords (comma-separated)
              </Label>
              <Input
                placeholder="e.g. crm software, best crm, sales tools"
                value={keywordsInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeywordsInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Body Content</Label>
              <Textarea
                placeholder="Paste or type your article content here..."
                value={body}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
                rows={14}
                className="resize-none font-mono text-xs"
              />
              {result && (
                <p className="text-xs text-muted-foreground">
                  {result.wordCount.toLocaleString()} words ·{" "}
                  {result.estimatedReadTime} min read
                </p>
              )}
            </div>
          </div>

          {/* Score side */}
          <div className="space-y-4">
            {/* Overall score */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overall SEO Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <span className={`text-5xl font-bold ${scoreColor}`}>
                    {optimizeMutation.isPending ? "…" : score}
                  </span>
                  <div className="flex-1 space-y-2">
                    <Progress value={score} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {score >= 70
                        ? "Strong — ready to publish"
                        : score >= 40
                          ? "Moderate — review suggestions"
                          : "Needs work — follow suggestions below"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Score breakdown */}
            {result && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Score Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ScoreBar label="Title" score={result.titleScore} max={20} />
                  <ScoreBar label="Body" score={result.bodyScore} max={25} />
                  <ScoreBar label="Keywords" score={result.keywordScore} max={25} />
                  <ScoreBar
                    label="Readability"
                    score={result.readabilityScore}
                    max={15}
                  />
                  <ScoreBar label="Meta" score={result.metaScore} max={15} />
                </CardContent>
              </Card>
            )}

            {/* Keyword density */}
            {result &&
              Object.keys(result.keywordDensity).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Keyword Density</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Object.entries(result.keywordDensity).map(([kw, d]) => (
                      <div
                        key={kw}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-muted-foreground truncate max-w-[60%]">
                          {kw}
                        </span>
                        <Badge
                          className={`border border-border text-xs ${d >= 0.5 && d <= 2.5 ? "border-emerald-500/30 text-emerald-600" : "border-amber-500/30 text-amber-600"}`}
                        >
                          {d}%
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

            {/* Suggestions */}
            {result && result.suggestions.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Suggestions ({result.suggestions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <SeverityIcon severity={s.severity} />
                      <p className="text-xs text-foreground leading-relaxed">
                        {s.message}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {result && result.suggestions.length === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2Icon className="h-4 w-4 text-emerald-500 shrink-0" />
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  No issues found. Content looks great!
                </p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
