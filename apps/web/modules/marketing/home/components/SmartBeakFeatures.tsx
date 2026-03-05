"use client";

import {
  GlobeIcon,
  PenToolIcon,
  SendIcon,
  ImageIcon,
  SearchIcon,
  BarChart3Icon,
  CreditCardIcon,
  ShieldIcon,
  RocketIcon,
  SparklesIcon,
  CalendarIcon,
  TrendingUpIcon,
} from "lucide-react";

const FEATURES = [
  {
    icon: GlobeIcon,
    title: "Domain Management",
    description:
      "Manage unlimited domains with DNS verification, health scoring, and transfer-readiness tracking. Full RBAC with owner/admin/editor/viewer roles.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: SparklesIcon,
    title: "AI Content Editor",
    description:
      "Rich Tiptap editor with revision history, AI idea generation, and real-time SEO scoring as you type. Powered by the Vercel AI SDK.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    icon: SendIcon,
    title: "11-Platform Publishing",
    description:
      "Publish to Web, Email (Resend), LinkedIn, YouTube, TikTok, Instagram, Pinterest, Vimeo, Facebook, WordPress, and SoundCloud from one place.",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    icon: SearchIcon,
    title: "SEO Intelligence",
    description:
      "Keyword tracking with volume, difficulty, position, and real-time decay signals. GSC + Ahrefs integration with automated daily reports.",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  {
    icon: BarChart3Icon,
    title: "Portfolio ROI Dashboard",
    description:
      "Risk-adjusted scoring, total portfolio value, performance trends, and buyer attribution tracking. Materialized views for instant queries.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: TrendingUpIcon,
    title: "Diligence Engine",
    description:
      "Automated ownership, legal, financial, and content checks. One-click Sell-Ready score with specific improvement recommendations.",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
  {
    icon: CalendarIcon,
    title: "Bulk Scheduling",
    description:
      "Drag-and-drop calendar view for scheduling content across all platforms. Bulk schedule with one form, live status tracking.",
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
  },
  {
    icon: ImageIcon,
    title: "Media Library",
    description:
      "Upload, organise, and reuse media assets across all your domains. Full lifecycle management with analytics per asset.",
    color: "text-rose-500",
    bg: "bg-rose-500/10",
  },
  {
    icon: ShieldIcon,
    title: "Immutable Audit Log",
    description:
      "Every action is recorded in an append-only audit trail. Full compliance-ready event history with actor, timestamp, and diff.",
    color: "text-slate-500",
    bg: "bg-slate-500/10",
  },
  {
    icon: CreditCardIcon,
    title: "Billing & Usage Quotas",
    description:
      "Stripe-powered subscriptions with per-org usage meters, monetisation decay signals, and plan enforcement at the API layer.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    icon: RocketIcon,
    title: "SmartDeploy",
    description:
      "One-click site deployment stub — SmartDeploy engine will be implemented via Replit Agent for full static site generation and CDN push.",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  {
    icon: PenToolIcon,
    title: "Email Series Builder",
    description:
      "Drag-and-drop drip campaign builder with Resend automation. Multi-step sequences with per-step delay, subject, and HTML body.",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
  },
];

export function SmartBeakFeatures() {
  return (
    <section id="features" className="py-16 lg:py-24 xl:py-32 scroll-mt-16">
      <div className="container max-w-6xl">
        {/* Header */}
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl leading-tight">
            Everything you need to{" "}
            <span className="text-primary">dominate your niche</span>
          </h2>
          <p className="mt-4 text-lg text-foreground/60 leading-relaxed">
            SmartBeak is a complete operating system for domain portfolio owners — from content creation
            to publishing, SEO, analytics, and exit readiness.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, title, description, color, bg }) => (
            <div
              key={title}
              className="group relative rounded-2xl border border-border/50 bg-card p-6 hover:border-primary/30 hover:shadow-lg transition-all duration-200"
            >
              <div className={`inline-flex size-10 items-center justify-center rounded-xl ${bg} mb-4`}>
                <Icon className={`size-5 ${color}`} />
              </div>
              <h3 className="font-semibold text-foreground text-base mb-2">{title}</h3>
              <p className="text-sm text-foreground/60 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
