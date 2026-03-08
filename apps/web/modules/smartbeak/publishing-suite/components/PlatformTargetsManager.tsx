"use client";
import type { PublishingSuiteTarget } from "@repo/database";
import { Button } from "@repo/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	GlobeIcon,
	InstagramIcon,
	LinkedinIcon,
	MailIcon,
	PlusIcon,
	SettingsIcon,
	ToggleLeftIcon,
	ToggleRightIcon,
	Trash2Icon,
	YoutubeIcon,
} from "lucide-react";
import { useState } from "react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";

const PLATFORMS = [
	{
		id: "web",
		label: "Web",
		icon: GlobeIcon,
		fields: [{ key: "siteUrl", label: "Site URL" }],
		supported: false,
		helpText:
			"SmartDeploy web publishing is not implemented in this publishing suite yet.",
	},
	{
		id: "email",
		label: "Email (Resend)",
		icon: MailIcon,
		fields: [
			{ key: "apiKey", label: "Resend API Key" },
			{ key: "audienceId", label: "Audience ID" },
		],
		supported: false,
		helpText:
			"Email publishing is not available yet because the current queue does not safely model recipients or per-message content.",
	},
	{
		id: "linkedin",
		label: "LinkedIn",
		icon: LinkedinIcon,
		fields: [
			{ key: "accessToken", label: "Access Token" },
			{ key: "organizationUrn", label: "Organization URN (optional)" },
		],
		supported: true,
	},
	{
		id: "youtube",
		label: "YouTube",
		icon: YoutubeIcon,
		fields: [
			{ key: "accessToken", label: "OAuth Access Token" },
			{ key: "refreshToken", label: "OAuth Refresh Token" },
			{ key: "channelId", label: "Channel ID" },
		],
		supported: false,
		helpText:
			"YouTube publishing is not available yet because the current queue cannot upload required video assets.",
	},
	{
		id: "instagram",
		label: "Instagram",
		icon: InstagramIcon,
		fields: [
			{ key: "accessToken", label: "Access Token" },
			{ key: "igUserId", label: "Instagram User ID" },
		],
		supported: false,
		helpText:
			"Instagram publishing is not available yet because the current queue cannot attach required media assets.",
	},
	{
		id: "tiktok",
		label: "TikTok",
		icon: GlobeIcon,
		fields: [
			{ key: "accessToken", label: "Access Token" },
			{ key: "openId", label: "Open ID" },
		],
		supported: false,
		helpText:
			"TikTok publishing is not available yet because the current queue cannot attach required video assets.",
	},
	{
		id: "pinterest",
		label: "Pinterest",
		icon: GlobeIcon,
		fields: [
			{ key: "accessToken", label: "Access Token" },
			{ key: "boardId", label: "Board ID" },
		],
		supported: true,
	},
	{
		id: "vimeo",
		label: "Vimeo",
		icon: GlobeIcon,
		fields: [{ key: "accessToken", label: "Access Token" }],
		supported: false,
		helpText:
			"Vimeo publishing is not available yet because the current queue cannot attach required video assets.",
	},
	{
		id: "facebook",
		label: "Facebook",
		icon: GlobeIcon,
		fields: [
			{ key: "accessToken", label: "Access Token" },
			{ key: "pageId", label: "Page ID" },
		],
		supported: true,
	},
	{
		id: "wordpress",
		label: "WordPress",
		icon: GlobeIcon,
		fields: [
			{ key: "siteUrl", label: "Site URL" },
			{ key: "username", label: "Username" },
			{ key: "appPassword", label: "App Password" },
		],
		supported: true,
	},
	{
		id: "soundcloud",
		label: "SoundCloud",
		icon: GlobeIcon,
		fields: [{ key: "accessToken", label: "Access Token" }],
		supported: true,
	},
] as const;

export function PlatformTargetsManager({
	organizationSlug,
	domainId,
}: {
	organizationSlug: string;
	domainId: string;
}) {
	const queryClient = useQueryClient();
	const [configDialog, setConfigDialog] = useState<{
		platformId: string;
		fields: { key: string; label: string }[];
	} | null>(null);
	const [configValues, setConfigValues] = useState<Record<string, string>>(
		{},
	);

	const closeConfigDialog = () => {
		setConfigDialog(null);
		setConfigValues({});
	};

	const targetsQuery = useQuery(
		orpc.smartbeak.publishingSuite.targets.list.queryOptions({
			input: { organizationSlug, domainId },
		}),
	);

	const upsertMutation = useMutation(
		orpc.smartbeak.publishingSuite.targets.upsert.mutationOptions({
			onSuccess: () => {
				toastSuccess(
					"Platform settings saved",
					"Target configuration was stored for this domain.",
				);
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite", "targets"],
				});
				closeConfigDialog();
			},
			onError: (err: unknown) =>
				toastError(
					"Failed to save",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const toggleMutation = useMutation(
		orpc.smartbeak.publishingSuite.targets.toggle.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite", "targets"],
				});
			},
			onError: (err: unknown) =>
				toastError(
					"Toggle failed",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const deleteMutation = useMutation(
		orpc.smartbeak.publishingSuite.targets.delete.mutationOptions({
			onSuccess: () => {
				toastSuccess("Platform removed");
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite", "targets"],
				});
			},
			onError: (err: unknown) =>
				toastError(
					"Delete failed",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const configuredTargets = new Map(
		(targetsQuery.data?.targets ?? []).map(
			(t: {
				id: string;
				target: string;
				enabled: boolean | null;
				createdAt: Date;
			}) => [t.target, t] as const,
		),
	);

	const handleSaveConfig = () => {
		if (!configDialog) {
			return;
		}

		const normalizedConfig = Object.fromEntries(
			Object.entries(configValues).map(([key, value]) => [key, value.trim()]),
		);
		const missingField = configDialog.fields.find(
			(field) => !normalizedConfig[field.key],
		);
		if (missingField) {
			toastError(
				"Incomplete configuration",
				`Enter a value for ${missingField.label} before saving.`,
			);
			return;
		}

		upsertMutation.mutate({
			organizationSlug,
			domainId,
			target: configDialog.platformId as PublishingSuiteTarget,
			config: normalizedConfig,
			enabled: true,
		});
	};

	if (targetsQuery.isError) {
		return (
			<ErrorBoundary>
				<div className="flex flex-col items-center py-8 text-center">
					<p className="text-sm text-destructive">
						Failed to load platform targets.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => targetsQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			</ErrorBoundary>
		);
	}

	if (targetsQuery.isLoading) {
		return (
			<ErrorBoundary>
				<CardGridSkeleton count={6} cols={3} />
			</ErrorBoundary>
		);
	}

	return (
		<ErrorBoundary>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{PLATFORMS.map((platform) => {
					const configured = configuredTargets.get(platform.id);
					const Icon = platform.icon;
					const canConfigure = platform.supported;

					return (
						<div
							key={platform.id}
							className={`rounded-xl border p-4 transition-colors ${
								configured?.enabled
									? "border-primary/30 bg-primary/5"
									: "border-border bg-card"
							}`}
						>
							<div className="flex items-start justify-between">
								<div className="flex items-center gap-2">
									<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
										<Icon className="h-4 w-4 text-muted-foreground" />
									</div>
									<div>
										<p className="text-sm font-medium">
											{platform.label}
										</p>
										<p className="text-xs text-muted-foreground">
											{!canConfigure
												? "Unavailable"
												: configured
												? configured.enabled
												? "Enabled"
													: "Disabled"
												: "Not configured"}
										</p>
									</div>
								</div>
								{configured && canConfigure && (
									<button
										type="button"
										aria-label={
											configured.enabled
												? "Disable platform"
												: "Enable platform"
										}
										onClick={() =>
											toggleMutation.mutate({
												organizationSlug,
												targetId: configured.id,
												enabled: !configured.enabled,
											})
										}
										className="text-muted-foreground hover:text-foreground"
										disabled={toggleMutation.isPending}
									>
										{configured.enabled ? (
											<ToggleRightIcon className="h-5 w-5 text-primary" />
										) : (
											<ToggleLeftIcon className="h-5 w-5" />
										)}
									</button>
								)}
							</div>

							<div className="mt-3 flex gap-2">
								<Button
									size="sm"
									variant={configured ? "outline" : "primary"}
									className="h-7 flex-1 gap-1 text-xs"
									onClick={
										canConfigure
											? () => {
													setConfigValues({});
													setConfigDialog({
														platformId: platform.id,
														fields: [...platform.fields],
													});
												}
											: undefined
									}
									disabled={
										!canConfigure ||
										upsertMutation.isPending ||
										toggleMutation.isPending ||
										deleteMutation.isPending
									}
								>
									{configured ? (
										<>
											<SettingsIcon className="h-3 w-3" />{" "}
											Edit Settings
										</>
									) : (
										<>
											<PlusIcon className="h-3 w-3" />{" "}
											Add Settings
										</>
									)}
								</Button>
								{configured && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 w-7 p-0 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
										onClick={() =>
											deleteMutation.mutate({
												organizationSlug,
												targetId: configured.id,
											})
										}
										aria-label="Delete target"
										disabled={deleteMutation.isPending}
									>
										<Trash2Icon className="h-3.5 w-3.5" />
									</Button>
								)}
							</div>
							{platform.helpText ? (
								<p className="mt-2 text-xs text-muted-foreground">
									{platform.helpText}
								</p>
							) : null}
						</div>
					);
				})}
			</div>

			{/* Config dialog */}
			{configDialog && (
				<Dialog open onOpenChange={(v) => !v && closeConfigDialog()}>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>
								Configure{" "}
								{
									PLATFORMS.find(
										(p) => p.id === configDialog.platformId,
									)?.label
								}
							</DialogTitle>
						</DialogHeader>
						<div className="space-y-3">
							{configDialog.fields.map((field) => (
								<div key={field.key}>
									<label
										htmlFor={`config-field-${field.key}`}
										className="mb-1 block text-xs font-medium text-muted-foreground"
									>
										{field.label}
									</label>
									<Input
										id={`config-field-${field.key}`}
										type={
											field.key
												.toLowerCase()
												.includes("token") ||
											field.key
												.toLowerCase()
												.includes("password") ||
											field.key
												.toLowerCase()
												.includes("key")
												? "password"
												: "text"
										}
										placeholder={field.label}
										value={configValues[field.key] ?? ""}
										onChange={(e) =>
											setConfigValues((v) => ({
												...v,
												[field.key]: e.target.value,
											}))
										}
									/>
								</div>
							))}
							<p className="text-xs text-muted-foreground">
								Credentials are encrypted at rest using
								AES-256-GCM before storage.
							</p>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={closeConfigDialog}
							>
								Cancel
							</Button>
							<Button
								onClick={handleSaveConfig}
								disabled={
									upsertMutation.isPending ||
									configDialog.fields.some(
										(field) =>
											!(configValues[field.key] ?? "").trim(),
									)
								}
							>
								{upsertMutation.isPending
									? "Saving…"
									: "Save Configuration"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</ErrorBoundary>
	);
}
