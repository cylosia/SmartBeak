import { WaitlistSection } from "@/modules/marketing/waitlist/components/WaitlistSection";
import { SmartBeakFeatures } from "@/modules/marketing/home/components/SmartBeakFeatures";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join the Waitlist — SmartBeak",
  description:
    "Get early access to SmartBeak — the AI-powered content publishing platform for domain portfolio owners. Join the waitlist and lock in founding member pricing.",
};

export default function WaitlistPage() {
  return (
    <main>
      {/* Hero */}
      <section className="py-16 lg:py-24 bg-muted/30">
        <div className="container max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
            Get early access to SmartBeak
          </h1>
          <p className="mt-4 text-lg text-foreground/60 max-w-xl mx-auto">
            Join hundreds of domain portfolio owners on the waitlist. Founding members get 40% off for life and priority access to every new feature.
          </p>
        </div>
      </section>

      {/* Waitlist form */}
      <Suspense fallback={<div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
        <WaitlistSection />
      </Suspense>

      {/* Feature highlights */}
      <SmartBeakFeatures />
    </main>
  );
}
