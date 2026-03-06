"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import { toastError } from "@repo/ui/components/toast";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";
import {
  CheckCircleIcon,
  GlobeIcon,
  FileTextIcon,
  CreditCardIcon,
  ZapIcon,
  SearchIcon,
  SendIcon,
  Loader2Icon,
} from "lucide-react";
import Link from "next/link";

const ONBOARDING_STEPS = [
  {
    key: "add_domain",
    title: "Add your first domain",
    description:
      "Connect a web property to start publishing and tracking performance.",
    icon: GlobeIcon,
    href: (slug: string) => `/app/${slug}/domains`,
    cta: "Add Domain",
  },
  {
    key: "create_content",
    title: "Create your first content",
    description:
      "Write and publish an article, guide, or page using the rich editor.",
    icon: FileTextIcon,
    href: (slug: string) => `/app/${slug}/domains`,
    cta: "Create Content",
  },
  {
    key: "setup_seo",
    title: "Set up SEO tracking",
    description:
      "Add keywords to monitor your search rankings and optimize visibility.",
    icon: SearchIcon,
    href: (slug: string) => `/app/${slug}/domains`,
    cta: "Setup SEO",
  },
  {
    key: "publish_content",
    title: "Publish to a channel",
    description:
      "Use the publishing engine to distribute content to web, email, or social.",
    icon: SendIcon,
    href: (slug: string) => `/app/${slug}/domains`,
    cta: "Publish",
  },
  {
    key: "setup_billing",
    title: "Set up billing",
    description:
      "Upgrade to a paid plan to unlock unlimited domains and AI features.",
    icon: CreditCardIcon,
    href: (slug: string) => `/app/${slug}/billing`,
    cta: "View Plans",
  },
  {
    key: "deploy_site",
    title: "Deploy your site",
    description:
      "Use SmartDeploy to push your site to the global edge network.",
    icon: ZapIcon,
    href: (slug: string) => `/app/${slug}/smart-deploy`,
    cta: "Deploy",
  },
];

export function OnboardingWizard({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const queryClient = useQueryClient();

  const progressQuery = useQuery(
    orpc.smartbeak.onboarding.getProgress.queryOptions({
      input: { organizationSlug },
    }),
  );

  const completeMutation = useMutation(
    orpc.smartbeak.onboarding.completeStep.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.smartbeak.onboarding.getProgress.key(),
        });
      },
      onError: (err) => {
        toastError("Error", err.message);
      },
    }),
  );

  const completedSteps = new Set(
    (progressQuery.data?.progress ?? [])
      .filter((p) => p.completed)
      .map((p) => p.step),
  );

  const completedCount = ONBOARDING_STEPS.filter((s) =>
    completedSteps.has(s.key),
  ).length;
  const progressPct = Math.round(
    (completedCount / ONBOARDING_STEPS.length) * 100,
  );

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {progressQuery.isLoading ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 text-sm text-muted-foreground">Loading onboarding progress…</p>
          </div>
        ) : progressQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-destructive">Failed to load onboarding progress.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => progressQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
        <>
        {/* Progress Header */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium">Setup Progress</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {completedCount} of {ONBOARDING_STEPS.length} steps completed
              </p>
            </div>
            <span className="text-2xl font-bold text-primary">
              {progressPct}%
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
          {progressPct === 100 && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-2">
              <CheckCircleIcon className="h-4 w-4" />
              All steps complete — your workspace is fully configured!
            </p>
          )}
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {ONBOARDING_STEPS.map((step, index) => {
            const isComplete = completedSteps.has(step.key);
            return (
              <Card
                key={step.key}
                className={`transition-all ${
                  isComplete
                    ? "opacity-60 border-emerald-200 dark:border-emerald-800"
                    : "hover:border-primary/40"
                }`}
              >
                <CardContent className="flex items-center gap-4 py-4">
                  {/* Step Number / Check */}
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                      isComplete
                        ? "bg-emerald-100 dark:bg-emerald-900/30"
                        : "bg-primary/10"
                    }`}
                  >
                    {isComplete ? (
                      <CheckCircleIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <step.icon className="h-5 w-5 text-primary" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-sm font-medium ${
                          isComplete ? "line-through text-muted-foreground" : ""
                        }`}
                      >
                        {step.title}
                      </p>
                      {!isComplete && index === completedCount && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          Next
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isComplete && (
                      <>
                        <Button variant="outline" size="sm" asChild>
                          <Link href={step.href(organizationSlug)}>
                            {step.cta}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            completeMutation.mutate({
                              organizationSlug,
                              step: step.key,
                            })
                          }
                          disabled={completeMutation.isPending}
                        >
                          {completeMutation.isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                          Mark done
                        </Button>
                      </>
                    )}
                    {isComplete && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        Completed
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        </>
        )}
      </div>
    </ErrorBoundary>
  );
}
