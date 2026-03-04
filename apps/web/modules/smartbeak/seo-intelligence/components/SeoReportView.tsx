"use client";

import { orpc } from "@/modules/smartbeak/shared/lib/api";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ui/components";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
} from "lucide-react";
import Link from "next/link";

interface Props {
  organizationSlug: string;
}

export function SeoReportView({ organizationSlug }: Props) {
  const reportQuery = useQuery(
    orpc.smartbeak.seoIntelligence.getSeoReport.queryOptions({
      input: { organizationSlug },
    }),
  );

  const data = reportQuery.data;
  const domains = data?.type === "org" ? data.domains : [];

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Summary cards */}
        {data?.type === "org" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Domains
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">{data.totalDomains}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Avg SEO Score
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div
                  className={`text-2xl font-bold ${data.avgSeoScore >= 70 ? "text-emerald-600" : data.avgSeoScore >= 40 ? "text-amber-600" : "text-red-600"}`}
                >
                  {data.avgSeoScore}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Total Keywords
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">
                  {data.totalKeywords.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Decaying
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div
                  className={`text-2xl font-bold ${data.totalDecaying > 0 ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {data.totalDecaying}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Domain table */}
        {reportQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : domains.length === 0 ? (
          <EmptyState
            icon={GlobeIcon}
            title="No domains found"
            description="Add domains to your organization to see SEO reports."
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Domain</TableHead>
                  <TableHead>SEO Score</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>Avg. Position</TableHead>
                  <TableHead>Decaying</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.domainId} className="group">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <GlobeIcon className="h-4 w-4 text-muted-foreground" />
                        {d.domainName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={d.seoScore ?? 0}
                          className="h-1.5 w-16"
                        />
                        <span
                          className={`text-sm font-medium ${(d.seoScore ?? 0) >= 70 ? "text-emerald-600" : (d.seoScore ?? 0) >= 40 ? "text-amber-600" : "text-red-600"}`}
                        >
                          {d.seoScore ?? 0}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {(d.keywordCount ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.avgPosition ? (
                        <div className="flex items-center gap-1">
                          <BarChart3Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          #{d.avgPosition}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(d.decayingCount ?? 0) > 0 ? (
                        <Badge className="bg-red-500/15 text-red-600 border-red-500/30 text-xs">
                          <AlertTriangleIcon className="mr-1 h-3 w-3" />
                          {d.decayingCount}
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs">
                          <CheckCircle2Icon className="mr-1 h-3 w-3" />
                          Clean
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`/app/${organizationSlug}/domains/${d.domainId}/seo-intelligence`}
                        >
                          <ExternalLinkIcon className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
