"use client";

import { Button } from "@repo/ui/components/button";
import { Badge } from "@repo/ui/components/badge";
import { CheckIcon } from "lucide-react";
import Link from "next/link";

const PLANS = [
  {
    name: "Starter",
    price: "$49",
    period: "/month",
    description: "Perfect for individual domain investors getting started.",
    highlight: false,
    badge: null,
    features: [
      "Up to 5 domains",
      "AI content ideas (50/month)",
      "3 publishing platforms",
      "Basic SEO tracking (10 keywords/domain)",
      "Media library (5 GB)",
      "Email publishing via Resend",
      "Standard support",
    ],
    cta: "Join Waitlist",
    href: "/waitlist",
  },
  {
    name: "Pro",
    price: "$149",
    period: "/month",
    description: "For serious portfolio owners who want the full platform.",
    highlight: true,
    badge: "Most Popular",
    features: [
      "Up to 25 domains",
      "AI content ideas (unlimited)",
      "All 11 publishing platforms",
      "Advanced SEO Intelligence",
      "Portfolio ROI Dashboard",
      "Diligence Engine + Sell-Ready Score",
      "Buyer attribution tracking",
      "Media library (50 GB)",
      "Email series builder",
      "Priority support",
    ],
    cta: "Join Waitlist",
    href: "/waitlist",
  },
  {
    name: "Agency",
    price: "$399",
    period: "/month",
    description: "For agencies and brokers managing multiple client portfolios.",
    highlight: false,
    badge: null,
    features: [
      "Unlimited domains",
      "Multi-tenant client workspaces",
      "Full RBAC (owner/admin/editor/viewer)",
      "White-label ready",
      "Custom analytics reports",
      "API access",
      "SLA + dedicated support",
      "SmartDeploy early access",
    ],
    cta: "Contact Sales",
    href: "/waitlist",
  },
];

export function SmartBeakPricing() {
  return (
    <section id="pricing" className="py-16 lg:py-24 xl:py-32 scroll-mt-16">
      <div className="container max-w-6xl">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl leading-tight">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-foreground/60">
            Start free during the beta. Founding members lock in 40% off for life.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {PLANS.map(({ name, price, period, description, highlight, badge, features, cta, href }) => (
            <div
              key={name}
              className={`relative rounded-2xl border p-8 flex flex-col gap-6 ${
                highlight
                  ? "border-primary bg-primary/5 shadow-xl shadow-primary/10"
                  : "border-border/50 bg-card"
              }`}
            >
              {badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="px-3 py-1 text-xs font-semibold">{badge}</Badge>
                </div>
              )}

              <div>
                <h3 className="text-lg font-bold text-foreground">{name}</h3>
                <p className="mt-1 text-sm text-foreground/60">{description}</p>
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-foreground">{price}</span>
                <span className="text-foreground/50 text-sm">{period}</span>
              </div>

              <ul className="space-y-3 flex-1">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground/70">
                    <CheckIcon className="size-4 text-primary shrink-0 mt-0.5" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                asChild
                variant={highlight ? "primary" : "outline"}
                className="w-full"
              >
                <Link href={href}>{cta}</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-foreground/40">
          All plans include a 14-day free trial. No credit card required to join the waitlist.
        </p>
      </div>
    </section>
  );
}
