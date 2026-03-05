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
import { toast, toastError } from "@repo/ui/components/toast";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
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
        toast({ title: "Platform configured", description: "Target saved securely." });
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
        setConfigDialog(null);
        setConfigValues({});
      },
      onError: (err: any) => toastError({ title: "Failed to save", description: err.message }),
    }),
  );

  const toggleMutation = useMutation(
    orpc.smartbeak.publishingSuite.targets.toggle.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
      },
      onError: (err: any) => toastError({ title: "Toggle failed", description: err.message }),
    }),
  );

  const deleteMutation = useMutation(
    orpc.smartbeak.publishingSuite.targets.delete.mutationOptions({
      onSuccess: () => {
        toast({ title: "Platform removed" });
        queryClient.invalidateQueries({ queryKey: ["smartbeak", "publishingSuite", "targets"] });
      },
      onError: (err: any) => toastError({ title: "Delete failed", description: err.message }),
    }),
  );

  const configuredTargets = new Map(
    (targetsQuery.data?.targets ?? []).map((t: any) => [t.target, t]),
  );

  const handleSaveConfig = () => {
    if (!configDialog) return;
    upsertMutation.mutate({
      organizationSlug,
      domainId,
      target: configDialog.platformId as any,
      config: configValues,
      enabled: true,
    });
  };

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
                  variant={configured ? "outline" : "default"}
                  className="h-7 flex-1 gap-1 text-xs"
                  onClick={() => {
                    setConfigValues({});
                    setConfigDialog({ platformId: platform.id, fields: platform.fields as any });
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
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                    onClick={() =>
                      deleteMutation.mutate({ organizationSlug, targetId: configured.id })
                    }
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
