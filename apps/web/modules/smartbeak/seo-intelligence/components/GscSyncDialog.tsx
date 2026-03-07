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
	const today = new Date().toISOString().split("T")[0]!;
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		.toISOString()
		.split("T")[0]!;

	const [siteUrl, setSiteUrl] = useState("https://");
	const [accessToken, setAccessToken] = useState("");
	const [startDate, setStartDate] = useState(thirtyDaysAgo);
	const [endDate, setEndDate] = useState(today);

	const syncMutation = useMutation(
		orpc.smartbeak.seoIntelligence.syncGsc.mutationOptions({
			onSuccess: (data) => {
				toastSuccess(
					"GSC sync complete",
					`Imported ${data.keywordsImported} keywords. SEO score updated to ${data.newScore}.`,
				);
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

	return (
		<Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
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
						<Label className="text-xs">
							Site URL (GSC property)
						</Label>
						<Input
							placeholder="https://yourdomain.com"
							value={siteUrl}
							onChange={(
								e: React.ChangeEvent<HTMLInputElement>,
							) => setSiteUrl(e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs">OAuth2 Access Token</Label>
						<Input
							type="password"
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
							<Label className="text-xs">Start Date</Label>
							<Input
								type="date"
								value={startDate}
								onChange={(
									e: React.ChangeEvent<HTMLInputElement>,
								) => setStartDate(e.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">End Date</Label>
							<Input
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
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={() =>
							syncMutation.mutate({
								organizationSlug,
								domainId,
								siteUrl,
								accessToken,
								startDate,
								endDate,
							})
						}
						disabled={
							syncMutation.isPending ||
							!siteUrl ||
							!siteUrl.startsWith("https://") ||
							siteUrl.length < 10 ||
							!accessToken ||
							!startDate ||
							!endDate
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
