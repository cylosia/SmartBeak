"use client";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { StatusBadge } from "@/modules/smartbeak/shared/components/StatusBadge";
import { MetricCard } from "@/modules/smartbeak/shared/components/MetricCard";
import { CardGridSkeleton, TableSkeleton } from "@/modules/smartbeak/shared/components/LoadingSkeleton";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import { Button } from "@repo/ui/components/button";
import {
  CreditCardIcon,
  ZapIcon,
  BarChart2Icon,
  CalendarIcon,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const DEFAULT_LIMITS: Record<string, number> = {
  domains: 10,
  content_items: 500,
  media_storage_gb: 10,
  ai_ideas: 100,
  publishing_jobs: 200,
};

const METRIC_LABELS: Record<string, string> = {
  domains: "Domains",
  content_items: "Content Items",
  media_storage_gb: "Media Storage (GB)",
  ai_ideas: "AI Ideas / month",
  publishing_jobs: "Publishing Jobs",
};

export function BillingView({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const billingQuery = useQuery(
    orpc.smartbeak.billing.get.queryOptions({
      input: { organizationSlug },
    }),
  );

  const subscription = billingQuery.data?.subscription;
  const invoices = billingQuery.data?.invoices ?? [];
  const usageRecords = billingQuery.data?.usageRecords ?? [];

  const usageQuotas = Object.entries(DEFAULT_LIMITS).map(([metric, limit]) => {
    const record = usageRecords.find((r) => r.metric === metric);
    return {
      label: METRIC_LABELS[metric] ?? metric,
      used: record ? Number(record.value) : 0,
      limit,
    };
  });

  return (
    <ErrorBoundary>
      <div className="space-y-8">
        {/* Plan Cards */}
        {billingQuery.isLoading ? (
          <CardGridSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Current Plan"
              value={subscription?.plan ?? "Free"}
              subtitle={`Status: ${subscription?.status ?? "inactive"}`}
              icon={ZapIcon}
            />
            <MetricCard
              title="Billing Cycle"
              value={subscription?.interval ?? "—"}
              subtitle={
                subscription?.currentPeriodEnd
                  ? `Renews ${format(new Date(subscription.currentPeriodEnd), "MMM d, yyyy")}`
                  : "No active subscription"
              }
              icon={CalendarIcon}
            />
            <MetricCard
              title="Next Invoice"
              value={
                subscription?.nextInvoiceAmount
                  ? `$${(Number(subscription.nextInvoiceAmount) / 100).toFixed(2)}`
                  : "—"
              }
              subtitle="Estimated amount"
              icon={CreditCardIcon}
            />
          </div>
        )}

        {/* Usage Quotas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart2Icon className="h-4 w-4" />
              Usage Quotas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {usageQuotas.map((quota) => {
              const ratio = quota.limit > 0 ? quota.used / quota.limit : 0;
              return (
              <div key={quota.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{quota.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {quota.used} / {quota.limit}
                  </span>
                </div>
                <Progress
                  value={ratio * 100}
                  className={`h-2 ${
                    ratio > 0.95
                      ? "[&>div]:bg-red-500"
                      : ratio > 0.8
                        ? "[&>div]:bg-amber-500"
                        : ""
                  }`}
                />
              </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Recent Invoices
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <a href={`/app/${organizationSlug}/settings/billing`}>
                <CreditCardIcon className="mr-2 h-4 w-4" />
                Manage Billing
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            {billingQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No invoices yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">
                        {inv.stripeInvoiceId ?? inv.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        ${(Number(inv.amount) / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status ?? "pending"} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {inv.createdAt
                          ? format(new Date(inv.createdAt), "MMM d, yyyy")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
