"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@repo/ui/components/dialog";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import type { PublishingSuiteTarget } from "@repo/database";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import {
  GlobeIcon,
  MailIcon,
  LinkedinIcon,
  YoutubeIcon,
  InstagramIcon,
  PlusIcon,
  Trash2Icon,
  ToggleLeftIcon,
  ToggleRightIcon,
  SettingsIcon,
} from "lucide-react";

const PLATFORMS = [
  { id: "web", label: "Web", icon: GlobeIcon, fields: [{ key: "siteUrl", label: "Site URL" }] },
  { id: "email", label: "Email (Resend)", icon: MailIcon, fields: [{ key: "apiKey", label: "Resend API Key" }, { key: "audienceId", label: "Audience ID" }] },
  { id: "linkedin", label: "LinkedIn", icon: LinkedinIcon, fields: [{ key: "accessToken", label: "Access Token" }, { key: "organizationId", label: "Organization ID" }] },
  { id: "youtube", label: "YouTube", icon: YoutubeIcon, fields: [{ key: "accessToken", label: "OAuth Access Token" }, { key: "channelId", label: "Channel ID" }] },
  { id: "instagram", label: "Instagram", icon: InstagramIcon, fields: [{ key: "accessToken", label: "Access Token" }, { key: "pageId", label: "Page ID" }] },
  { id: "tiktok", label: "TikTok", icon: GlobeIcon, fields: [{ key: "accessToken", label: "Access Token" }] },
  { id: "pinterest", label: "Pinterest", icon: GlobeIcon, fields: [{ key: "accessToken", label: "Access Token" }, { key: "boardId", label: "Board ID" }] },
  { id: "vimeo", label: "Vimeo", icon: GlobeIcon, fields: [{ key: "accessToken", label: "Access Token" }] },
  { id: "facebook", label: "Facebook", icon: GlobeIcon, fields: [{ key: "accessToken", label: "Access Token" }, { key: "pageId", label: "Page ID" }] },
  { id: "wordpress", label: "WordPress", icon: GlobeIcon, fields: [{ key: "siteUrl", label: "Site URL" }, { key: "username", label: "Username" }, { key: "appPassword", label: "App Password" }] },
  { id: "soundcloud", label: "SoundCloud", icon: GlobeIcon, fields: [{ key: "accessToken", label: "Access Token" }] },
] as const;

export function PlatformTargetsManager({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const queryClient = useQueryClient();
  const [configDialog, setConfigDialog] = useState<{ platformId: string; fields: { key: string; label: string }[] } | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const targetsQuery = useQuery(
    orpc.smartbeak.publishingSuite.targets.list.queryOptions({
      input: { organizationSlug, domainId },
    }),
  );

  const upsertMutation = useMutation(
    orpc.smartbeak.publishingSuite.targets.upsert.mutationOptions({
      onSuccess: () => {
        toastSuccess("Platform configured", "Target saved securely.");
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
        setConfigDialog(null);
        setConfigValues({});
      },
      onError: (err: unknown) => toastError("Failed to save", err instanceof Error ? err.message : "Unknown error"),
    }),
  );

  const toggleMutation = useMutation(
    orpc.smartbeak.publishingSuite.targets.toggle.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
      },
      onError: (err: unknown) => toastError("Toggle failed", err instanceof Error ? err.message : "Unknown error"),
    }),
  );

  const deleteMutation = useMutation(
    orpc.smartbeak.publishingSuite.targets.delete.mutationOptions({
      onSuccess: () => {
        toastSuccess("Platform removed");
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
      },
      onError: (err: unknown) => toastError("Delete failed", err instanceof Error ? err.message : "Unknown error"),
    }),
  );

  const configuredTargets = new Map(
    (targetsQuery.data?.targets ?? []).map((t: { id: string; target: string; enabled: boolean | null; createdAt: Date }) => [t.target, t] as const),
  );

  const handleSaveConfig = () => {
    if (!configDialog) return;
    upsertMutation.mutate({
      organizationSlug,
      domainId,
      target: configDialog.platformId as PublishingSuiteTarget,
      config: configValues,
      enabled: true,
    });
  };

  if (targetsQuery.isError) {
    return (
      <ErrorBoundary>
        <div className="flex flex-col items-center py-8 text-center">
          <p className="text-sm text-destructive">Failed to load platform targets.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => targetsQuery.refetch()}>
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
                    <p className="text-sm font-medium">{platform.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {configured ? (configured.enabled ? "Active" : "Disabled") : "Not configured"}
                    </p>
                  </div>
                </div>
                {configured && (
                  <button
                    aria-label={configured.enabled ? "Disable platform" : "Enable platform"}
                    onClick={() =>
                      toggleMutation.mutate({
                        organizationSlug,
                        targetId: configured.id,
                        enabled: !configured.enabled,
                      })
                    }
                    className="text-muted-foreground hover:text-foreground"
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
                  onClick={() => {
                    setConfigValues({});
                    setConfigDialog({ platformId: platform.id, fields: [...platform.fields] });
                  }}
                >
                  {configured ? (
                    <><SettingsIcon className="h-3 w-3" /> Reconfigure</>
                  ) : (
                    <><PlusIcon className="h-3 w-3" /> Connect</>
                  )}
                </Button>
                {configured && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                    onClick={() =>
                      deleteMutation.mutate({ organizationSlug, targetId: configured.id })
                    }
                    aria-label="Delete target"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Config dialog */}
      {configDialog && (
        <Dialog open onOpenChange={(v) => !v && setConfigDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                Configure {PLATFORMS.find((p) => p.id === configDialog.platformId)?.label}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {configDialog.fields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {field.label}
                  </label>
                  <Input
                    type={field.key.toLowerCase().includes("token") || field.key.toLowerCase().includes("password") || field.key.toLowerCase().includes("key") ? "password" : "text"}
                    placeholder={field.label}
                    value={configValues[field.key] ?? ""}
                    onChange={(e) => setConfigValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Credentials are encrypted at rest using AES-256-GCM before storage.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfigDialog(null)}>Cancel</Button>
              <Button onClick={handleSaveConfig} disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? "Saving…" : "Save Configuration"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </ErrorBoundary>
  );
}
