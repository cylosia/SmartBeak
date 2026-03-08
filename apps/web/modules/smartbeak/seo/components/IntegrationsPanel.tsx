"use client";

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
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/tooltip";
import {
	CheckCircle2Icon,
	CircleDotIcon,
	ExternalLinkIcon,
	LinkIcon,
	SearchIcon,
	UploadIcon,
} from "lucide-react";

interface SeoDocData {
	gscData?: Record<string, unknown> | null;
	ahrefsData?: Record<string, unknown> | null;
}

function normalizeString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNonNegativeNumber(value: unknown) {
	const normalized = normalizeNumber(value);
	return normalized == null ? null : Math.max(0, normalized);
}

function clampPercent(value: unknown) {
	const normalized = normalizeNumber(value);
	if (normalized == null) {
		return null;
	}
	return Math.min(1, Math.max(0, normalized));
}

function formatRecordedTimestamp(value: unknown) {
	const normalized = normalizeString(value);
	if (!normalized) {
		return "—";
	}

	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? normalized : date.toLocaleString();
}

function GscSummary({ data }: { data: Record<string, unknown> }) {
	const siteUrl = normalizeString(data.siteUrl);
	const startDate = normalizeString(data.startDate);
	const endDate = normalizeString(data.endDate);
	const rowCount = normalizeNonNegativeNumber(data.rowCount);
	const syncedAt = formatRecordedTimestamp(data.syncedAt);

	return (
		<div className="grid grid-cols-2 gap-3">
			<StatItem
				label="Recorded Site"
				value={siteUrl ?? "—"}
			/>
			<StatItem
				label="Recorded Range"
				value={
					startDate && endDate ? `${startDate} to ${endDate}` : "—"
				}
			/>
			<StatItem
				label="Recorded Rows"
				value={rowCount != null ? rowCount.toLocaleString() : "—"}
			/>
			<StatItem
				label="Last Sync"
				value={syncedAt}
			/>
		</div>
	);
}

function AhrefsSummary({ data }: { data: Record<string, unknown> }) {
	const target = normalizeString(data.target);
	const mode = normalizeString(data.mode);
	const rowCount = normalizeNonNegativeNumber(data.rowCount);
	const syncedAt = formatRecordedTimestamp(data.syncedAt);

	return (
		<div className="grid grid-cols-2 gap-3">
			<StatItem
				label="Recorded Target"
				value={target ?? "—"}
			/>
			<StatItem
				label="Recorded Mode"
				value={mode ?? "—"}
			/>
			<StatItem
				label="Recorded Rows"
				value={rowCount != null ? rowCount.toLocaleString() : "—"}
			/>
			<StatItem
				label="Last Sync"
				value={syncedAt}
			/>
		</div>
	);
}

function StatItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg bg-muted/50 px-3 py-2">
			<p className="text-[11px] text-muted-foreground">{label}</p>
			<p className="text-sm font-semibold tabular-nums">{value}</p>
		</div>
	);
}

function IntegrationCard({
	icon: Icon,
	name,
	description,
	hasRecordedData,
	children,
}: {
	icon: typeof SearchIcon;
	name: string;
	description: string;
	hasRecordedData: boolean;
	children?: React.ReactNode;
}) {
	return (
		<Card className="relative overflow-hidden">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
							<Icon className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-base">{name}</CardTitle>
							<CardDescription className="text-xs">
								{description}
							</CardDescription>
						</div>
					</div>
					{hasRecordedData ? (
						<Badge status="success" className="gap-1 text-xs">
							<CheckCircle2Icon className="h-3 w-3" />
							Data Recorded
						</Badge>
					) : (
						<Badge className="gap-1 text-xs bg-muted text-muted-foreground">
							<CircleDotIcon className="h-3 w-3" />
							No Recorded Data
						</Badge>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{hasRecordedData && children ? (
					children
				) : (
					<div className="flex flex-col items-center gap-3 py-4 text-center">
						<p className="text-sm text-muted-foreground">
							{hasRecordedData
								? "No recorded sync metadata is available yet."
								: "Direct integration setup is not available from this screen yet."}
						</p>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="outline"
										size="sm"
										disabled
										className="gap-1.5"
									>
										<ExternalLinkIcon className="h-3.5 w-3.5" />
										Unavailable
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<p>
										Setup and automatic sync are not available
										from this panel yet.
									</p>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function IntegrationsPanel({
	seoDoc,
}: {
	seoDoc: SeoDocData | null | undefined;
}) {
	const hasGsc =
		seoDoc?.gscData != null && Object.keys(seoDoc.gscData).length > 0;
	const hasAhrefs =
		seoDoc?.ahrefsData != null && Object.keys(seoDoc.ahrefsData).length > 0;

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<IntegrationCard
					icon={SearchIcon}
					name="Google Search Console"
					description="Recorded Search Console sync metadata for this domain"
					hasRecordedData={hasGsc}
				>
					{hasGsc && seoDoc?.gscData && (
						<GscSummary data={seoDoc.gscData} />
					)}
				</IntegrationCard>

				<IntegrationCard
					icon={LinkIcon}
					name="Ahrefs"
					description="Recorded Ahrefs sync metadata for this domain"
					hasRecordedData={hasAhrefs}
				>
					{hasAhrefs && seoDoc?.ahrefsData && (
						<AhrefsSummary data={seoDoc.ahrefsData} />
					)}
				</IntegrationCard>
			</div>

			<Card>
				<CardContent className="flex items-center justify-between p-4">
					<div>
						<p className="text-sm font-medium">Manual CSV Import</p>
						<p className="text-xs text-muted-foreground">
							CSV import is not available from this panel yet
						</p>
					</div>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									disabled
									className="gap-1.5"
								>
									<UploadIcon className="h-3.5 w-3.5" />
									Unavailable
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>CSV import is not available yet.</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</CardContent>
			</Card>
		</div>
	);
}
