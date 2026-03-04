"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { Badge } from "@repo/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import {
  SearchIcon,
  LinkIcon,
  ExternalLinkIcon,
  UploadIcon,
  CheckCircle2Icon,
  CircleDotIcon,
} from "lucide-react";

interface SeoDocData {
  gscData?: Record<string, unknown> | null;
  ahrefsData?: Record<string, unknown> | null;
}

function GscSummary({ data }: { data: Record<string, unknown> }) {
  const impressions = typeof data.impressions === "number" ? data.impressions : null;
  const clicks = typeof data.clicks === "number" ? data.clicks : null;
  const ctr = typeof data.ctr === "number" ? data.ctr : null;
  const avgPosition = typeof data.avgPosition === "number" ? data.avgPosition : null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatItem label="Impressions" value={impressions != null ? impressions.toLocaleString() : "—"} />
      <StatItem label="Clicks" value={clicks != null ? clicks.toLocaleString() : "—"} />
      <StatItem label="CTR" value={ctr != null ? `${(ctr * 100).toFixed(1)}%` : "—"} />
      <StatItem label="Avg Position" value={avgPosition != null ? `#${avgPosition.toFixed(1)}` : "—"} />
    </div>
  );
}

function AhrefsSummary({ data }: { data: Record<string, unknown> }) {
  const dr = typeof data.dr === "number" ? data.dr : null;
  const referringDomains = typeof data.referringDomains === "number" ? data.referringDomains : null;
  const backlinks = typeof data.backlinks === "number" ? data.backlinks : null;
  const organicKeywords = typeof data.organicKeywords === "number" ? data.organicKeywords : null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatItem label="Domain Rating" value={dr != null ? String(dr) : "—"} />
      <StatItem label="Ref. Domains" value={referringDomains != null ? referringDomains.toLocaleString() : "—"} />
      <StatItem label="Backlinks" value={backlinks != null ? backlinks.toLocaleString() : "—"} />
      <StatItem label="Organic KW" value={organicKeywords != null ? organicKeywords.toLocaleString() : "—"} />
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
  isConnected,
  children,
}: {
  icon: typeof SearchIcon;
  name: string;
  description: string;
  isConnected: boolean;
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
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          {isConnected ? (
            <Badge status="success" className="gap-1 text-xs">
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
      <CardContent>
        {isConnected && children ? (
          children
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              {isConnected ? "No data available yet." : "Connect to sync your data automatically."}
            </p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" disabled className="gap-1.5">
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                    Connect
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Coming soon — API integrations are in development</p>
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
  const hasGsc = seoDoc?.gscData != null && Object.keys(seoDoc.gscData).length > 0;
  const hasAhrefs = seoDoc?.ahrefsData != null && Object.keys(seoDoc.ahrefsData).length > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IntegrationCard
          icon={SearchIcon}
          name="Google Search Console"
          description="Impressions, clicks, CTR, and position data"
          isConnected={hasGsc}
        >
          {hasGsc && seoDoc?.gscData && <GscSummary data={seoDoc.gscData} />}
        </IntegrationCard>

        <IntegrationCard
          icon={LinkIcon}
          name="Ahrefs"
          description="Domain rating, backlinks, and organic keywords"
          isConnected={hasAhrefs}
        >
          {hasAhrefs && seoDoc?.ahrefsData && <AhrefsSummary data={seoDoc.ahrefsData} />}
        </IntegrationCard>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">Manual CSV Import</p>
            <p className="text-xs text-muted-foreground">Upload keyword data from any SEO tool</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" disabled className="gap-1.5">
                  <UploadIcon className="h-3.5 w-3.5" />
                  Import CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Coming soon</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}
