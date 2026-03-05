"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useActiveOrganization } from "@saas/organizations/hooks/use-active-organization";
import { SettingsItem } from "@saas/shared/components/SettingsItem";
import { Button } from "@repo/ui/components/button";
import { Badge } from "@repo/ui/components/badge";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import {
	BrainCircuitIcon,
	SearchIcon,
	LinkIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	Loader2Icon,
	Trash2Icon,
	ZapIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

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
		description: "Powers AI content ideas, SEO optimization, and content generation.",
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
		description: "Sync impressions, clicks, CTR, and position data.",
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
		description: "Domain rating, backlinks, and organic keyword data.",
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
	onMutationSuccess,
}: {
	provider: ProviderDefinition;
	integration: IntegrationState | undefined;
	organizationSlug: string;
	onMutationSuccess: () => void;
}) {
	const isConnected = integration?.hasKey ?? false;

	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [isSaving, setIsSaving] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const upsertMutation = useMutation(
		orpc.smartbeak.settings.integrations.upsert.mutationOptions({
			onSuccess: () => {
				toastSuccess("Integration saved", `${provider.name} key has been saved and encrypted.`);
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
			onSuccess: (data: { success: boolean; message: string }) => {
				toastSuccess("Connection test passed", data.message);
				setIsTesting(false);
			},
			onError: (err: Error) => {
				toastError("Connection test failed", err.message);
				setIsTesting(false);
			},
		}),
	);

	const deleteMutation = useMutation(
		orpc.smartbeak.settings.integrations.delete.mutationOptions({
			onSuccess: () => {
				toastSuccess("Integration removed", `${provider.name} has been disconnected.`);
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
							<CardTitle className="text-base">{provider.name}</CardTitle>
							<CardDescription className="text-xs">
								{provider.description}
							</CardDescription>
						</div>
					</div>
					{isConnected ? (
						<Badge className="gap-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
							<CheckCircle2Icon className="h-3 w-3" />
							Connected
						</Badge>
					) : (
						<Badge className="gap-1 text-xs bg-muted text-muted-foreground">
							<CircleDotIcon className="h-3 w-3" />
							Not Connected
						</Badge>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{provider.fields.map((field) => (
					<div key={field.key} className="space-y-1.5">
						<Label htmlFor={`${provider.id}-${field.key}`} className="text-sm">
							{field.label}
						</Label>
						<Input
							id={`${provider.id}-${field.key}`}
							type={field.type}
							placeholder={isConnected && field.key === "apiKey" ? "••••••••••••••••" : field.placeholder}
							value={fieldValues[field.key] ?? ""}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
								setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
							}
						/>
					</div>
				))}

				<div className="flex items-center gap-2 pt-2">
					<Button
						size="sm"
						onClick={handleSave}
						disabled={isSaving || !fieldValues.apiKey}
					>
						{isSaving ? (
							<Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : null}
						{isConnected ? "Update Key" : "Save Key"}
					</Button>

					{isConnected && (
						<>
							<Button
								variant="outline"
								size="sm"
								onClick={handleTest}
								disabled={isTesting}
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
			description="Connect third-party services by adding your API keys. Keys are encrypted at rest using AES-256-GCM."
		>
			<div className="space-y-4">
				{PROVIDERS.map((provider) => {
					const integration = integrations.find(
						(i) => i.provider === provider.id,
					);
					return (
						<ProviderCard
							key={provider.id}
							provider={provider}
							integration={integration as IntegrationState | undefined}
							organizationSlug={organizationSlug}
							onMutationSuccess={handleMutationSuccess}
						/>
					);
				})}
			</div>
		</SettingsItem>
	);
}
