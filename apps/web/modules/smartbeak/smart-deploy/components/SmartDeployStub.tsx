"use client";
import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import {
  ZapIcon,
  GlobeIcon,
  ServerIcon,
  ShieldCheckIcon,
  ClockIcon,
  CheckCircleIcon,
  Loader2Icon,
} from "lucide-react";

const DEPLOY_STEPS = [
  { id: 1, label: "Validating domain configuration", duration: 800 },
  { id: 2, label: "Building static assets", duration: 1200 },
  { id: 3, label: "Pushing to edge network", duration: 900 },
  { id: 4, label: "Propagating DNS records", duration: 600 },
  { id: 5, label: "Running health checks", duration: 700 },
];

const FEATURE_CARDS = [
  {
    icon: GlobeIcon,
    title: "Global Edge Network",
    description:
      "Deploy to 200+ PoPs worldwide for sub-50ms TTFB from any location.",
  },
  {
    icon: ServerIcon,
    title: "Zero-Config Builds",
    description:
      "Automatic framework detection and optimized build pipelines.",
  },
  {
    icon: ShieldCheckIcon,
    title: "SSL & DDoS Protection",
    description:
      "Automatic TLS provisioning and enterprise-grade DDoS mitigation.",
  },
  {
    icon: ClockIcon,
    title: "Instant Rollbacks",
    description:
      "One-click rollback to any previous deployment with full audit trail.",
  },
];

export function SmartDeployStub({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [deploying, setDeploying] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [done, setDone] = useState(false);

  const handleDeploy = async () => {
    setDeploying(true);
    setCompletedSteps([]);
    setDone(false);

    for (const step of DEPLOY_STEPS) {
      await new Promise((r) => setTimeout(r, step.duration));
      setCompletedSteps((prev) => [...prev, step.id]);
    }

    setDeploying(false);
    setDone(true);
  };

  const handleReset = () => {
    setDone(false);
    setCompletedSteps([]);
  };

  return (
    <div className="space-y-8">
      {/* Hero Deploy Card */}
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-2 ring-primary/20">
              <ZapIcon className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">SmartDeploy</h2>
              <p className="mt-1 text-muted-foreground max-w-md">
                Deploy your site to the global edge network in seconds. Zero
                configuration required.
              </p>
            </div>
            <Badge
              variant="outline"
              className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20"
            >
              SmartDeploy engine will be implemented via Replit Agent
            </Badge>

            {!deploying && !done && (
              <Button size="lg" className="mt-2 px-8" onClick={handleDeploy}>
                <ZapIcon className="mr-2 h-5 w-5" />
                Deploy Site
              </Button>
            )}

            {(deploying || done) && (
              <div className="w-full max-w-sm space-y-2 text-left mt-4">
                {DEPLOY_STEPS.map((step) => {
                  const isComplete = completedSteps.includes(step.id);
                  const isActive =
                    deploying &&
                    !isComplete &&
                    completedSteps.length === step.id - 1;
                  return (
                    <div
                      key={step.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
                        isActive
                          ? "bg-primary/10"
                          : isComplete
                            ? "opacity-70"
                            : "opacity-30"
                      }`}
                    >
                      {isComplete ? (
                        <CheckCircleIcon className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      ) : isActive ? (
                        <Loader2Icon className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                      )}
                      <span className="text-sm">{step.label}</span>
                    </div>
                  );
                })}

                {done && (
                  <div className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 text-center">
                    <CheckCircleIcon className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
                      Deployment simulation complete!
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
                      Full deployment will be powered by the Replit Agent engine.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={handleReset}
                    >
                      Deploy Again
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURE_CARDS.map((feature) => (
          <Card
            key={feature.title}
            className="hover:border-primary/40 transition-colors"
          >
            <CardHeader className="pb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 mb-2">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-sm font-semibold">
                {feature.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Implementation Note */}
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <ServerIcon className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Implementation Note</p>
              <p className="text-sm text-muted-foreground mt-1">
                The SmartDeploy engine is a planned feature. The full
                implementation — including Vercel/Netlify API integration, build
                queue management, rollback orchestration, and real-time
                deployment logs — will be implemented via the{" "}
                <strong>Replit Agent</strong>. This stub provides the complete
                UI shell, routing, and interaction patterns ready for the engine
                to be wired in.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
