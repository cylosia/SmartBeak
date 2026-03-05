"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import {
  CheckCircle2Icon,
  AlertTriangleIcon,
  XCircleIcon,
  XIcon,
  SearchIcon,
} from "lucide-react";
import { analyzeContent, type SeoAnalysis, type SeoCheck } from "../lib/seo-analyzer";

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const strokeClass = score >= 70
    ? "stroke-emerald-500"
    : score >= 40
      ? "stroke-amber-500"
      : "stroke-red-500";
  const textClass = score >= 70
    ? "text-emerald-600 dark:text-emerald-400"
    : score >= 40
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
      <svg className="-rotate-90" width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          className={strokeClass}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <span className={`text-2xl font-bold tabular-nums ${textClass}`}>{score}</span>
        <p className="text-[10px] text-muted-foreground">SEO</p>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const Icon = check.status === "pass" ? CheckCircle2Icon
    : check.status === "warning" ? AlertTriangleIcon
      : XCircleIcon;
  const color = check.status === "pass" ? "text-emerald-500"
    : check.status === "warning" ? "text-amber-500"
      : "text-red-500";

  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{check.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{check.value}</span>
        </div>
        <p className="text-xs text-muted-foreground">{check.tip}</p>
      </div>
    </div>
  );
}

export function ContentSeoSidebar({
  html,
  isOpen,
  onClose,
}: {
  html: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [targetKeyword, setTargetKeyword] = useState("");
  const [debouncedHtml, setDebouncedHtml] = useState(html);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHtml(html), 500);
    return () => clearTimeout(timer);
  }, [html]);

  const analysis: SeoAnalysis = useMemo(
    () => analyzeContent(debouncedHtml, targetKeyword || undefined),
    [debouncedHtml, targetKeyword],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  if (!isOpen) return null;

  return (
    <div className="w-72 shrink-0 border-l border-border bg-background overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <h3 className="text-sm font-semibold">SEO Analysis</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <XIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 p-4">
        <ScoreRing score={analysis.overallScore} />

        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Target keyword..."
            value={targetKeyword}
            onChange={(e) => setTargetKeyword(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="divide-y divide-border">
          {analysis.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </div>
    </div>
  );
}
