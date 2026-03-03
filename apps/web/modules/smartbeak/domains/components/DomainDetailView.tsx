"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/toast";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  GlobeIcon,
  ShieldCheckIcon,
  FileTextIcon,
  ImageIcon,
  SendIcon,
  SearchIcon,
  TrendingUpIcon,
  ZapIcon,
  BarChart2Icon,
  RocketIcon,
  ExternalLinkIcon,
  Loader2Icon,
  EyeIcon,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export function DomainDetailView({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);

  const domainQuery = useQuery(
    orpc.smartbeak.domains.get.queryOptions({
      input: { organizationSlug, id: domainId },
    }),
  );

  const deployStatusQuery = useQuery(
    orpc.smartbeak.deploy.status.queryOptions({
      input: { organizationSlug, domainId },
      refetchInterval: (query) => {
        const latest = query.state.data?.latest;
        if (latest && (latest.status === "building" || latest.status === "deploying")) {
          return 3000;
        }
        return false;
      },
    }),
  );

  const deployMutation = useMutation(
    orpc.smartbeak.deploy.trigger.mutationOptions({
      onSuccess: (data) => {
        toast({
          title: "Deployment started",
          description: `Version ${data.shard.version} is being deployed.`,
        });
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.deploy.status.key(),
        });
      },
      onError: (err) => {
        toast({ title: "Deploy failed", description: err.message, variant: "error" });
      },
    }),
  );

  const domain = domainQuery.data?.domain;
  const latestShard = deployStatusQuery.data?.latest;
  const isDeploying = latestShard?.status === "building" || latestShard?.status === "deploying";

  const QUICK_LINKS = [
    {
      label: "Content",
      icon: FileTextIcon,
      href: `/app/${organizationSlug}/domains/${domainId}/content`,
      description: "Manage articles and pages",
    },
    {
      label: "Media",
      icon: ImageIcon,
      href: `/app/${organizationSlug}/domains/${domainId}/media`,
      description: "Upload and manage assets",
    },
    {
      label: "Publishing",
      icon: SendIcon,
      href: `/app/${organizationSlug}/domains/${domainId}/publishing`,
      description: "Multi-channel distribution",
    },
    {
      label: "SEO",
      icon: SearchIcon,
      href: `/app/${organizationSlug}/domains/${domainId}/seo`,
      description: "Keyword tracking and scores",
    },
    {
      label: "Diligence",
      icon: BarChart2Icon,
      href: `/app/${organizationSlug}/domains/${domainId}/diligence`,
      description: "Decay signals and buyer data",
    },
    {
      label: "SmartDeploy",
      icon: ZapIcon,
      href: `/app/${organizationSlug}/smart-deploy`,
      description: "Deploy to edge network",
    },
  ];

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Domain Info Cards */}
        {domainQuery.isLoading ? (
          <CardGridSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Domain"
              value={domain?.name ?? "—"}
              subtitle="Primary domain name"
              icon={GlobeIcon}
            />
            <MetricCard
              title="Status"
              value={domain?.status ?? "—"}
              subtitle="Current domain status"
              icon={ShieldCheckIcon}
            />
            <MetricCard
              title="DNS Verified"
              value={domain?.dnsVerified ? "Yes" : "No"}
              subtitle={
                domain?.dnsVerifiedAt
                  ? `Verified ${formatDistanceToNow(new Date(domain.dnsVerifiedAt), { addSuffix: true })}`
                  : "Not yet verified"
              }
              icon={ShieldCheckIcon}
            />
            <MetricCard
              title="Transfer Ready"
              value={domain?.transferReady ? "Yes" : "No"}
              subtitle="Domain transfer readiness"
              icon={TrendingUpIcon}
            />
          </div>
        )}

        {/* Domain Details */}
        {domain && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Domain Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Registrar
                  </p>
                  <p className="text-sm font-medium mt-1">
                    {domain.registrar ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Expiry Date
                  </p>
                  <p className="text-sm font-medium mt-1">
                    {domain.expiryDate
                      ? new Date(domain.expiryDate).toLocaleDateString()
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    DNS Provider
                  </p>
                  <p className="text-sm font-medium mt-1">
                    {domain.dnsProvider ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Nameservers
                  </p>
                  <p className="text-sm font-medium mt-1 font-mono text-xs">
                    {domain.nameservers
                      ? (domain.nameservers as string[]).join(", ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Health Score
                  </p>
                  <p className="text-sm font-medium mt-1">
                    {domain.healthScore ?? "—"}
                    {domain.healthScore ? "/100" : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Last Health Check
                  </p>
                  <p className="text-sm font-medium mt-1">
                    {domain.lastHealthCheck
                      ? formatDistanceToNow(new Date(domain.lastHealthCheck), {
                          addSuffix: true,
                        })
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deploy & Preview */}
        {domain && (
          <Card className="border-primary/20">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <RocketIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">SmartDeploy</p>
                  {latestShard?.deployedUrl ? (
                    <a
                      href={latestShard.deployedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline underline-offset-2 flex items-center gap-1"
                    >
                      {latestShard.deployedUrl}
                      <ExternalLinkIcon className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not deployed yet</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {latestShard?.deployedUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPreview(!showPreview)}
                  >
                    <EyeIcon className="mr-2 h-4 w-4" />
                    {showPreview ? "Hide Preview" : "Preview"}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    deployMutation.mutate({
                      organizationSlug,
                      domainId,
                    })
                  }
                  disabled={deployMutation.isPending || isDeploying}
                >
                  {deployMutation.isPending || isDeploying ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RocketIcon className="mr-2 h-4 w-4" />
                  )}
                  {isDeploying ? "Deploying..." : "Deploy Site"}
                </Button>
              </div>
            </CardContent>
            {showPreview && latestShard?.deployedUrl && (
              <div className="border-t border-border">
                <iframe
                  src={latestShard.deployedUrl}
                  title="Site preview"
                  className="w-full h-[500px] bg-white rounded-b-xl"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}
          </Card>
        )}

        {/* Quick Links Grid */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Domain Tools
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <Link key={link.label} href={link.href}>
                <Card className="hover:border-primary/50 hover:bg-primary/5 hover:scale-[1.02] transition-all cursor-pointer group">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                      <link.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{link.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {link.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
