import { SmartBeakHero } from "@/modules/marketing/home/components/SmartBeakHero";
import { SmartBeakFeatures } from "@/modules/marketing/home/components/SmartBeakFeatures";
import { Testimonials } from "@/modules/marketing/home/components/Testimonials";
import { SmartBeakPricing } from "@/modules/marketing/home/components/SmartBeakPricing";
import { WaitlistSection } from "@/modules/marketing/waitlist/components/WaitlistSection";
import { Suspense } from "react";

export default function HomePage() {
  return (
    <main>
      <SmartBeakHero />
      <SmartBeakFeatures />
      <Testimonials />
      <SmartBeakPricing />
      <Suspense>
        <WaitlistSection />
      </Suspense>
    </main>
  );
}
