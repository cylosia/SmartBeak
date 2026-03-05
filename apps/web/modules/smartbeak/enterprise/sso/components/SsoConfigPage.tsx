"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Badge } from "@repo/ui/components/badge";
import { cn } from "@repo/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Separator } from "@repo/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton as LoadingSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toastSuccess, toastError } from "@repo/ui/components/toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const samlSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  providerName: z.string().max(100).optional(),
  entityId: z.string().min(1, "IdP Entity ID is required"),
  ssoUrl: z.string().url("Must be a valid URL"),
  certificate: z.string().min(1, "X.509 certificate is required"),
  spEntityId: z.string().min(1, "SP Entity ID is required"),
  spAcsUrl: z.string().url("ACS URL must be a valid URL"),
});

const oidcSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  providerName: z.string().max(100).optional(),
  issuer: z.string().url("Issuer must be a valid URL"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  redirectUri: z.string().url("Redirect URI must be a valid URL"),
});

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
  inactive: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  testing: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800",
};

interface SsoConfigPageProps {
  organizationSlug: string;
}

export function SsoConfigPage({ organizationSlug }: SsoConfigPageProps) {
  const queryClient = useQueryClient();
  const [ssoDialogOpen, setSsoDialogOpen] = useState(false);
  const [ssoType, setSsoType] = useState<"saml" | "oidc">("saml");
  const [newScimToken, setNewScimToken] = useState<string | null>(null);
  const [scimTokenDesc, setScimTokenDesc] = useState("");

  const providersQuery = useQuery(
    orpc.enterprise.sso.providers.list.queryOptions({
      input: { organizationSlug },
    }),
  );

  const scimTokensQuery = useQuery(
    orpc.enterprise.sso.scim.listTokens.queryOptions({
      input: { organizationSlug },
    }),
  );

  const samlForm = useForm({ resolver: zodResolver(samlSchema) });
  const oidcForm = useForm({ resolver: zodResolver(oidcSchema) });

  const upsertSsoMutation = useMutation(
    orpc.enterprise.sso.providers.upsert.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.sso.providers.list.key({
            input: { organizationSlug },
          }),
        });
        setSsoDialogOpen(false);
        samlForm.reset();
        oidcForm.reset();
        toastSuccess("SSO provider saved successfully.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const updateStatusMutation = useMutation(
    orpc.enterprise.sso.providers.updateStatus.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.sso.providers.list.key({
            input: { organizationSlug },
          }),
        });
        toastSuccess("Provider status updated.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const deleteSsoMutation = useMutation(
    orpc.enterprise.sso.providers.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.sso.providers.list.key({
            input: { organizationSlug },
          }),
        });
        toastSuccess("SSO provider deleted.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const createScimTokenMutation = useMutation(
    orpc.enterprise.sso.scim.createToken.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.sso.scim.listTokens.key({
            input: { organizationSlug },
          }),
        });
        setNewScimToken(data.token.rawToken);
        setScimTokenDesc("");
        toastSuccess("SCIM token created. Copy it now — it won't be shown again.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const deleteScimTokenMutation = useMutation(
    orpc.enterprise.sso.scim.deleteToken.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.enterprise.sso.scim.listTokens.key({
            input: { organizationSlug },
          }),
        });
        toastSuccess("SCIM token revoked.");
      },
      onError: (err) => toastError("Error", err.message),
    }),
  );

  const handleSamlSubmit = samlForm.handleSubmit((data) => {
    upsertSsoMutation.mutate({
      organizationSlug,
      type: "saml",
      domain: data.domain,
      providerName: data.providerName,
      config: {
        entityId: data.entityId,
        ssoUrl: data.ssoUrl,
        certificate: data.certificate,
        spEntityId: data.spEntityId,
        spAcsUrl: data.spAcsUrl,
      },
    });
  });

  const handleOidcSubmit = oidcForm.handleSubmit((data) => {
    upsertSsoMutation.mutate({
      organizationSlug,
      type: "oidc",
      domain: data.domain,
      providerName: data.providerName,
      config: {
        issuer: data.issuer,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        redirectUri: data.redirectUri,
        scopes: ["openid", "email", "profile"],
      },
    });
  });

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* SSO Providers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/50">
                  <ShieldCheckIcon className="size-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle>Single Sign-On</CardTitle>
                  <CardDescription>
                    Configure SAML 2.0 or OIDC providers for your organization.
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => setSsoDialogOpen(true)}
                className="gap-2"
              >
                <PlusIcon className="size-4" />
                Add Provider
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {providersQuery.isLoading ? (
              <LoadingSkeleton rows={2} />
            ) : providersQuery.data?.providers.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <ShieldCheckIcon className="size-10 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">No SSO providers configured</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add a SAML or OIDC provider to enable single sign-on.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSsoDialogOpen(true)}
                >
                  Configure SSO
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providersQuery.data?.providers.map((provider) => (
                    <TableRow key={provider.id}>
                      <TableCell className="font-medium">
                        {provider.providerName ?? "Unnamed Provider"}
                      </TableCell>
                      <TableCell>
                        <Badge className="uppercase text-xs border bg-transparent">
                          {provider.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {provider.domain}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn("border bg-transparent", statusColors[provider.status] ?? "")}
                        >
                          {provider.status === "active" && (
                            <CheckCircle2Icon className="size-3 mr-1" />
                          )}
                          {provider.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Select
                            value={provider.status}
                            onValueChange={(v) =>
                              updateStatusMutation.mutate({
                                organizationSlug,
                                providerId: provider.id,
                                status: v as "active" | "inactive" | "testing",
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="testing">Testing</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            onClick={() =>
                              deleteSsoMutation.mutate({
                                organizationSlug,
                                providerId: provider.id,
                              })
                            }
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* SCIM Provisioning */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-950/50">
                  <ZapIcon className="size-5 text-violet-600" />
                </div>
                <div>
                  <CardTitle>SCIM Provisioning</CardTitle>
                  <CardDescription>
                    Automate user provisioning and deprovisioning via your IdP.
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  createScimTokenMutation.mutate({
                    organizationSlug,
                    description: scimTokenDesc || undefined,
                  })
                }
                disabled={createScimTokenMutation.isPending}
              >
                <KeyIcon className="size-4" />
                Generate Token
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {newScimToken && (
              <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                <CheckCircle2Icon className="size-4 text-green-600" />
                <AlertDescription className="space-y-2">
                  <p className="font-medium text-sm text-green-800 dark:text-green-200">
                    Token created — copy it now. It will not be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-green-100 dark:bg-green-900/40 px-3 py-1.5 text-xs font-mono break-all">
                      {newScimToken}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(newScimToken);
                        toastSuccess("Copied to clipboard.");
                      }}
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setNewScimToken(null)}
                  >
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {scimTokensQuery.isLoading ? (
              <LoadingSkeleton rows={2} />
            ) : scimTokensQuery.data?.tokens.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <KeyIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No SCIM tokens. Generate one to connect your IdP.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scimTokensQuery.data?.tokens.map((token) => (
                    <TableRow key={token.id}>
                      <TableCell className="text-sm">
                        {token.description ?? (
                          <span className="text-muted-foreground italic">
                            No description
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        ••••••••{token.tokenSuffix}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {token.lastUsedAt
                          ? formatDistanceToNow(new Date(token.lastUsedAt), {
                              addSuffix: true,
                            })
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {token.expiresAt
                          ? format(new Date(token.expiresAt), "MMM d, yyyy")
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          onClick={() =>
                            deleteScimTokenMutation.mutate({
                              organizationSlug,
                              tokenId: token.id,
                            })
                          }
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* SSO Config Dialog */}
        <Dialog open={ssoDialogOpen} onOpenChange={setSsoDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configure SSO Provider</DialogTitle>
              <DialogDescription>
                Set up SAML 2.0 or OpenID Connect for your organization.
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={ssoType}
              onValueChange={(v) => setSsoType(v as "saml" | "oidc")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="saml">SAML 2.0</TabsTrigger>
                <TabsTrigger value="oidc">OpenID Connect</TabsTrigger>
              </TabsList>

              <TabsContent value="saml" className="space-y-4 mt-4">
                <form onSubmit={handleSamlSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Email Domain *</Label>
                      <Input
                        placeholder="acme.com"
                        {...samlForm.register("domain")}
                      />
                      {samlForm.formState.errors.domain && (
                        <p className="text-xs text-destructive">
                          {samlForm.formState.errors.domain.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Provider Name</Label>
                      <Input
                        placeholder="e.g. Okta, Azure AD"
                        {...samlForm.register("providerName")}
                      />
                    </div>
                  </div>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Identity Provider Settings
                  </p>
                  <div className="space-y-2">
                    <Label>IdP Entity ID *</Label>
                    <Input
                      placeholder="https://your-idp.com/entity-id"
                      {...samlForm.register("entityId")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>IdP SSO URL *</Label>
                    <Input
                      placeholder="https://your-idp.com/sso/saml"
                      {...samlForm.register("ssoUrl")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>X.509 Certificate *</Label>
                    <Textarea
                      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                      rows={4}
                      className="font-mono text-xs"
                      {...samlForm.register("certificate")}
                    />
                  </div>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Service Provider Settings
                  </p>
                  <div className="space-y-2">
                    <Label>SP Entity ID *</Label>
                    <Input
                      placeholder="https://app.smartbeak.com/saml/sp"
                      {...samlForm.register("spEntityId")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ACS URL *</Label>
                    <Input
                      placeholder="https://app.smartbeak.com/saml/acs"
                      {...samlForm.register("spAcsUrl")}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSsoDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={upsertSsoMutation.isPending}
                    >
                      {upsertSsoMutation.isPending ? "Saving…" : "Save SAML Provider"}
                    </Button>
                  </DialogFooter>
                </form>
              </TabsContent>

              <TabsContent value="oidc" className="space-y-4 mt-4">
                <form onSubmit={handleOidcSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Email Domain *</Label>
                      <Input
                        placeholder="acme.com"
                        {...oidcForm.register("domain")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Provider Name</Label>
                      <Input
                        placeholder="e.g. Auth0, Google Workspace"
                        {...oidcForm.register("providerName")}
                      />
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Issuer URL *</Label>
                    <Input
                      placeholder="https://accounts.google.com"
                      {...oidcForm.register("issuer")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID *</Label>
                      <Input {...oidcForm.register("clientId")} />
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret *</Label>
                      <Input type="password" {...oidcForm.register("clientSecret")} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Redirect URI *</Label>
                    <Input
                      placeholder="https://app.smartbeak.com/auth/oidc/callback"
                      {...oidcForm.register("redirectUri")}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSsoDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={upsertSsoMutation.isPending}
                    >
                      {upsertSsoMutation.isPending ? "Saving…" : "Save OIDC Provider"}
                    </Button>
                  </DialogFooter>
                </form>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
