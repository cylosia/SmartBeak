import { SmartBeakHero } from "@/modules/marketing/home/components/SmartBeakHero";
import { SmartBeakFeatures } from "@/modules/marketing/home/components/SmartBeakFeatures";
import { Testimonials } from "@/modules/marketing/home/components/Testimonials";
import { SmartBeakPricing } from "@/modules/marketing/home/components/SmartBeakPricing";
import { WaitlistSection } from "@/modules/marketing/waitlist/components/WaitlistSection";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SmartBeak — AI-Powered Domain Portfolio Management",
  description:
    "Manage, publish, and grow your domain portfolio with AI-driven insights, automated publishing, and real-time analytics.",
  openGraph: {
    title: "SmartBeak — AI-Powered Domain Portfolio Management",
    description:
      "Manage, publish, and grow your domain portfolio with AI-driven insights, automated publishing, and real-time analytics.",
  },
};

export default function HomePage() {
  return (
    <main>
      <SmartBeakHero />
      <SmartBeakFeatures />
      <Testimonials />
      <SmartBeakPricing />
      <Suspense fallback={<div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
        <WaitlistSection />
      </Suspense>
    </main>
  );
}
