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
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Skeleton } from "@repo/ui/components/skeleton";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { useActiveOrganization } from "@saas/organizations/hooks/use-active-organization";
import { SettingsItem } from "@saas/shared/components/SettingsItem";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangleIcon,
	BrainCircuitIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	LinkIcon,
	Loader2Icon,
	SearchIcon,
	Trash2Icon,
	ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

interface ProviderDefinition {
	id: "openai" | "google_search_console" | "ahrefs";
	name: string;
	description: string;
	icon: ReactNode;
	fields: ProviderField[];
}

interface ProviderField {
	key: "apiKey" | "siteUrl";
	label: string;
	placeholder: string;
	type: "password" | "url";
	required: boolean;
}

const PROVIDERS: ProviderDefinition[] = [
	{
		id: "openai",
		name: "OpenAI",
		description:
			"Powers AI content ideas, SEO optimization, and content generation.",
		icon: <BrainCircuitIcon className="h-5 w-5 text-primary" />,
		fields: [
			{
				key: "apiKey",
				label: "API Key",
				placeholder: "sk-...",
				type: "password",
				required: true,
			},
		],
	},
	{
		id: "google_search_console",
		name: "Google Search Console",
		description:
			"Store credentials for administrative GSC workflows. This screen does not validate or run sync jobs.",
		icon: <SearchIcon className="h-5 w-5 text-primary" />,
		fields: [
			{
				key: "apiKey",
				label: "API Key / Service Account JSON",
				placeholder: "Enter your API key",
				type: "password",
				required: true,
			},
			{
				key: "siteUrl",
				label: "Site URL",
				placeholder: "https://example.com",
				type: "url",
				required: false,
			},
		],
	},
	{
		id: "ahrefs",
		name: "Ahrefs",
		description:
			"Store credentials for manual Ahrefs imports. This screen does not validate or run sync jobs.",
		icon: <LinkIcon className="h-5 w-5 text-primary" />,
		fields: [
			{
				key: "apiKey",
				label: "API Key",
				placeholder: "Enter your Ahrefs API key",
				type: "password",
				required: true,
			},
			{
				key: "siteUrl",
				label: "Target Domain",
				placeholder: "https://example.com",
				type: "url",
				required: false,
			},
		],
	},
];

const LIVE_TESTABLE_PROVIDERS = new Set<ProviderDefinition["id"]>(["openai"]);

interface IntegrationState {
	id: string;
	provider: string;
	enabled: boolean | null;
	hasKey: boolean;
	createdAt: Date;
}

function ProviderCard({
	provider,
	integration,
	organizationSlug,
	encryptionConfigured,
	onMutationSuccess,
}: {
	provider: ProviderDefinition;
	integration: IntegrationState | undefined;
	organizationSlug: string;
	encryptionConfigured: boolean;
	onMutationSuccess: () => void;
}) {
	const hasSavedKey = integration?.hasKey ?? false;
	const supportsLiveTest = LIVE_TESTABLE_PROVIDERS.has(provider.id);

	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [isSaving, setIsSaving] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const upsertMutation = useMutation(
		orpc.smartbeak.settings.integrations.upsert.mutationOptions({
			onSuccess: () => {
				toastSuccess(
					"Credential saved",
					supportsLiveTest
						? `${provider.name} credentials were saved and encrypted.`
						: `${provider.name} credentials were stored encrypted for this organization.`,
				);
				setFieldValues({});
				onMutationSuccess();
				setIsSaving(false);
			},
			onError: (err: Error) => {
				toastError("Failed to save", err.message);
				setIsSaving(false);
			},
		}),
	);

	const testMutation = useMutation(
		orpc.smartbeak.settings.integrations.test.mutationOptions({
			onSuccess: (data) => {
				toastSuccess(
					"Connection test passed",
					(data as { message: string }).message,
				);
				setIsTesting(false);
			},
			onError: (err) => {
				toastError("Connection test failed", err.message);
				setIsTesting(false);
			},
		}),
	);

	const deleteMutation = useMutation(
		orpc.smartbeak.settings.integrations.delete.mutationOptions({
			onSuccess: () => {
				toastSuccess(
					"Credential removed",
					`${provider.name} stored credentials were removed.`,
				);
				setFieldValues({});
				onMutationSuccess();
				setIsDeleting(false);
			},
			onError: (err: Error) => {
				toastError("Failed to remove", err.message);
				setIsDeleting(false);
			},
		}),
	);

	function handleSave() {
		const apiKey = fieldValues.apiKey ?? "";
		if (!apiKey) {
			toastError("Missing API key", "Please enter an API key.");
			return;
		}
		setIsSaving(true);
		upsertMutation.mutate({
			organizationSlug,
			provider: provider.id,
			config: {
				apiKey,
				siteUrl: fieldValues.siteUrl || undefined,
			},
			enabled: true,
		});
	}

	function handleTest() {
		setIsTesting(true);
		testMutation.mutate({
			organizationSlug,
			provider: provider.id,
		});
	}

	function handleDelete() {
		setIsDeleting(true);
		deleteMutation.mutate({
			organizationSlug,
			provider: provider.id,
		});
	}

	return (
		<Card className="relative overflow-hidden">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
							{provider.icon}
						</div>
						<div>
							<CardTitle className="text-base">
								{provider.name}
							</CardTitle>
							<CardDescription className="text-xs">
								{provider.description}
							</CardDescription>
						</div>
					</div>
					{hasSavedKey ? (
						<Badge className="gap-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
							<CheckCircle2Icon className="h-3 w-3" />
							Credential Saved
						</Badge>
					) : (
						<Badge className="gap-1 text-xs bg-muted text-muted-foreground">
							<CircleDotIcon className="h-3 w-3" />
							Not Configured
						</Badge>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{!encryptionConfigured ? (
					<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
						Encrypted key storage is not configured in this
						environment yet. Saving and testing integrations is
						unavailable until an administrator sets
						`SMARTBEAK_ENCRYPTION_KEY`.
					</p>
				) : null}

				{provider.fields.map((field) => (
					<div key={field.key} className="space-y-1.5">
						<Label
							htmlFor={`${provider.id}-${field.key}`}
							className="text-sm"
						>
							{field.label}
						</Label>
						<Input
							id={`${provider.id}-${field.key}`}
							type={field.type}
							placeholder={
								hasSavedKey && field.key === "apiKey"
									? "••••••••••••••••"
									: field.placeholder
							}
							value={fieldValues[field.key] ?? ""}
							onChange={(
								e: React.ChangeEvent<HTMLInputElement>,
							) =>
								setFieldValues((prev) => ({
									...prev,
									[field.key]: e.target.value,
								}))
							}
						/>
					</div>
				))}

				<div className="flex items-center gap-2 pt-2">
					<Button
						size="sm"
						onClick={handleSave}
						disabled={
							isSaving ||
							!fieldValues.apiKey ||
							!encryptionConfigured
						}
					>
						{isSaving ? (
							<Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : null}
						{!encryptionConfigured
							? "Unavailable"
							: hasSavedKey
								? "Update Key"
								: "Save Key"}
					</Button>

					{hasSavedKey && (
						<>
							<Button
								variant="outline"
								size="sm"
								onClick={handleTest}
								disabled={
									isTesting ||
									!supportsLiveTest ||
									!encryptionConfigured
								}
							>
								{isTesting ? (
									<Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								) : (
									<ZapIcon className="mr-1.5 h-3.5 w-3.5" />
								)}
								Test Connection
							</Button>

							<Button
								variant="ghost"
								size="sm"
								onClick={handleDelete}
								disabled={isDeleting}
								className="text-destructive hover:text-destructive"
							>
								{isDeleting ? (
									<Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								) : (
									<Trash2Icon className="mr-1.5 h-3.5 w-3.5" />
								)}
								Disconnect
							</Button>
						</>
					)}
				</div>

				{hasSavedKey && !supportsLiveTest ? (
					<p className="text-xs text-muted-foreground">
						Live credential verification is not available for this
						provider. Saving the key stores it securely, but the app
						does not validate or automatically use it from this screen.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

export function IntegrationsSettingsForm() {
	const { activeOrganization } = useActiveOrganization();
	const queryClient = useQueryClient();
	const organizationSlug = activeOrganization?.slug ?? "";

	const integrationsQuery = useQuery(
		orpc.smartbeak.settings.integrations.list.queryOptions({
			input: { organizationSlug },
			enabled: !!organizationSlug,
		}),
	);

	const integrations = integrationsQuery.data?.integrations ?? [];
	const encryptionConfigured =
		integrationsQuery.data?.encryptionConfigured ?? true;

	function handleMutationSuccess() {
		queryClient.invalidateQueries({
			queryKey: orpc.smartbeak.settings.integrations.list.queryOptions({
				input: { organizationSlug },
			}).queryKey,
		});
	}

	return (
		<SettingsItem
			title="API Integrations"
			description="Store third-party provider credentials for SmartBeak. When encryption is configured, credentials are stored encrypted at rest; only supported providers can be validated from this screen."
		>
			{integrationsQuery.isLoading ? (
				<div className="space-y-4">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-48 rounded-xl" />
					))}
				</div>
			) : integrationsQuery.isError ? (
				<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 py-12 gap-3">
					<AlertTriangleIcon className="h-8 w-8 text-destructive opacity-60" />
					<div className="text-center">
						<p className="font-medium text-destructive text-sm">
							Failed to load integrations
						</p>
						<p className="text-xs text-muted-foreground mt-1">
							{integrationsQuery.error?.message ??
								"An unexpected error occurred."}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => integrationsQuery.refetch()}
					>
						Try Again
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					{!encryptionConfigured ? (
						<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
							Integration key storage is unavailable in this
							environment because `SMARTBEAK_ENCRYPTION_KEY` is not
							configured.
						</div>
					) : null}

					{PROVIDERS.map((provider) => {
						const integration = integrations.find(
							(i) => i.provider === provider.id,
						);
						return (
							<ProviderCard
								key={provider.id}
								provider={provider}
								integration={
									integration as IntegrationState | undefined
								}
								organizationSlug={organizationSlug}
								encryptionConfigured={encryptionConfigured}
								onMutationSuccess={handleMutationSuccess}
							/>
						);
					})}
				</div>
			)}
		</SettingsItem>
	);
}
