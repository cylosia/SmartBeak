"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import { ArrowRightIcon, ClockIcon } from "lucide-react";

interface AiIdea {
	title: string;
	outline: string;
	keywords: string[];
	contentType: string;
	estimatedReadTime: number;
	seoScore: number;
}

function SeoScoreGauge({ score }: { score: number }) {
	const radius = 28;
	const circumference = 2 * Math.PI * radius;
	const progress = (score / 100) * circumference;
	const color =
		score >= 70
			? "text-emerald-500 dark:text-emerald-400"
			: score >= 40
				? "text-amber-500 dark:text-amber-400"
				: "text-red-500 dark:text-red-400";
	const strokeColor =
		score >= 70
			? "stroke-emerald-500 dark:stroke-emerald-400"
			: score >= 40
				? "stroke-amber-500 dark:stroke-amber-400"
				: "stroke-red-500 dark:stroke-red-400";

	return (
		<div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
			<svg
				aria-hidden="true"
				className="-rotate-90"
				width="64"
				height="64"
				viewBox="0 0 64 64"
			>
				<circle
					cx="32"
					cy="32"
					r={radius}
					fill="none"
					stroke="hsl(var(--muted))"
					strokeWidth="4"
				/>
				<circle
					cx="32"
					cy="32"
					r={radius}
					fill="none"
					className={strokeColor}
					strokeWidth="4"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference - progress}
					style={{ transition: "stroke-dashoffset 0.6s ease" }}
				/>
			</svg>
			<span
				className={`absolute text-sm font-bold tabular-nums ${color}`}
			>
				{score}
			</span>
		</div>
	);
}

export function AiIdeaCard({
	idea,
	onUseTitle,
}: {
	idea: AiIdea;
	onUseTitle: (title: string) => void;
}) {
	const contentTypeLabels: Record<string, string> = {
		article: "Article",
		listicle: "Listicle",
		guide: "Guide",
		"case-study": "Case Study",
		"how-to": "How-To",
	};

	return (
		<Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
			<CardContent className="flex gap-4 p-4">
				<SeoScoreGauge score={idea.seoScore} />
				<div className="flex-1 min-w-0 space-y-2">
					<div className="flex items-start justify-between gap-2">
						<h4 className="text-sm font-semibold leading-snug line-clamp-2">
							{idea.title}
						</h4>
					</div>

					<p className="text-xs text-muted-foreground line-clamp-1">
						{idea.outline}
					</p>

					<div className="flex flex-wrap items-center gap-1.5">
						<Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-0">
							{contentTypeLabels[idea.contentType] ??
								idea.contentType}
						</Badge>
						<span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
							<ClockIcon className="h-3 w-3" />
							{idea.estimatedReadTime} min
						</span>
					</div>

					<div className="flex flex-wrap gap-1">
						{(idea.keywords ?? []).slice(0, 3).map((kw) => (
							<span
								key={kw}
								className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
							>
								{kw}
							</span>
						))}
					</div>

					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
						onClick={() => onUseTitle(idea.title)}
					>
						Use as Title
						<ArrowRightIcon className="h-3 w-3" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export function AiIdeaCardSkeleton() {
	return (
		<Card className="overflow-hidden">
			<CardContent className="flex gap-4 p-4">
				<Skeleton className="h-16 w-16 rounded-full shrink-0" />
				<div className="flex-1 space-y-2">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-3 w-full" />
					<div className="flex gap-1.5">
						<Skeleton className="h-4 w-14 rounded-full" />
						<Skeleton className="h-4 w-10 rounded-full" />
					</div>
					<div className="flex gap-1">
						<Skeleton className="h-4 w-16 rounded-full" />
						<Skeleton className="h-4 w-14 rounded-full" />
						<Skeleton className="h-4 w-18 rounded-full" />
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
