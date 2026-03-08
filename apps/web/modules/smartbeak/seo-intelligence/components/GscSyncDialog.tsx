"use client";

import { Button } from "@repo/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { useMutation } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { orpc } from "@/modules/smartbeak/shared/lib/api";

interface Props {
	organizationSlug: string;
	domainId: string;
	onClose: () => void;
	onSuccess: () => void;
}

export function GscSyncDialog({
	organizationSlug,
	domainId,
	onClose,
	onSuccess,
}: Props) {
	const today = new Date().toISOString().split("T")[0] ?? "";
	const thirtyDaysAgo =
		new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
			.toISOString()
			.split("T")[0] ?? "";

	const [siteUrl, setSiteUrl] = useState("https://");
	const [accessToken, setAccessToken] = useState("");
	const [startDate, setStartDate] = useState(thirtyDaysAgo);
	const [endDate, setEndDate] = useState(today);

	const resetForm = () => {
		setSiteUrl("https://");
		setAccessToken("");
		setStartDate(thirtyDaysAgo);
		setEndDate(today);
	};

	const handleClose = () => {
		resetForm();
		onClose();
	};

	const syncMutation = useMutation(
		orpc.smartbeak.seoIntelligence.syncGsc.mutationOptions({
			onSuccess: (data) => {
				toastSuccess(
					"GSC sync recorded",
					`Recorded ${data.keywordsImported} keyword rows. Heuristic SEO score recalculated to ${data.newScore}.`,
				);
				resetForm();
				onSuccess();
			},
			onError: (err) => {
				toastError(
					"GSC sync failed",
					err.message ?? "Check your access token and site URL.",
				);
			},
		}),
	);

	const trimmedSiteUrl = siteUrl.trim();
	const trimmedAccessToken = accessToken.trim();
	const hasValidDateRange =
		Boolean(startDate) && Boolean(endDate) && startDate <= endDate;

	const handleSync = () => {
		if (!hasValidDateRange) {
			toastError(
				"Invalid date range",
				"Start date must be on or before end date.",
			);
			return;
		}

		syncMutation.mutate({
			organizationSlug,
			domainId,
			siteUrl: trimmedSiteUrl,
			accessToken: trimmedAccessToken,
			startDate,
			endDate,
		});
	};

	return (
		<Dialog open onOpenChange={(open: boolean) => !open && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ExternalLinkIcon className="h-4 w-4" />
						Sync Google Search Console
					</DialogTitle>
					<DialogDescription>
						Import keyword rankings and impressions from your GSC
						property. Requires a valid OAuth2 access token with
						Search Console read access.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-1.5">
						<Label htmlFor="gsc-site-url" className="text-xs">
							Site URL (GSC property)
						</Label>
						<Input
							id="gsc-site-url"
							placeholder="https://yourdomain.com"
							value={siteUrl}
							onChange={(
								e: React.ChangeEvent<HTMLInputElement>,
							) => setSiteUrl(e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="gsc-access-token" className="text-xs">
							OAuth2 Access Token
						</Label>
						<Input
							id="gsc-access-token"
							type="password"
							autoComplete="off"
							placeholder="ya29...."
							value={accessToken}
							onChange={(
								e: React.ChangeEvent<HTMLInputElement>,
							) => setAccessToken(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							Generate via{" "}
							<a
								href="https://developers.google.com/oauthplayground"
								target="_blank"
								rel="noopener noreferrer"
								className="underline"
							>
								OAuth Playground
							</a>{" "}
							with the{" "}
							<code className="text-xs bg-muted px-1 rounded">
								webmasters.readonly
							</code>{" "}
							scope.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="gsc-start-date" className="text-xs">
								Start Date
							</Label>
							<Input
								id="gsc-start-date"
								type="date"
								value={startDate}
								onChange={(
									e: React.ChangeEvent<HTMLInputElement>,
								) => setStartDate(e.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="gsc-end-date" className="text-xs">
								End Date
							</Label>
							<Input
								id="gsc-end-date"
								type="date"
								value={endDate}
								onChange={(
									e: React.ChangeEvent<HTMLInputElement>,
								) => setEndDate(e.target.value)}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSync}
						disabled={
							syncMutation.isPending ||
							!trimmedSiteUrl ||
							!trimmedSiteUrl.startsWith("https://") ||
							trimmedSiteUrl.length < 10 ||
							!trimmedAccessToken ||
							!startDate ||
							!endDate ||
							!hasValidDateRange
						}
					>
						{syncMutation.isPending ? (
							<>
								<RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
								Syncing...
							</>
						) : (
							<>
								<RefreshCwIcon className="mr-2 h-4 w-4" />
								Sync Now
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
