import type { Metadata } from "next";
import { Suspense } from "react";
import { SmartBeakFeatures } from "@/modules/marketing/home/components/SmartBeakFeatures";
import { SmartBeakHero } from "@/modules/marketing/home/components/SmartBeakHero";
import { SmartBeakPricing } from "@/modules/marketing/home/components/SmartBeakPricing";
import { Testimonials } from "@/modules/marketing/home/components/Testimonials";
import { WaitlistSection } from "@/modules/marketing/waitlist/components/WaitlistSection";

export const metadata: Metadata = {
	title: "SmartBeak — AI-Powered Domain Portfolio Management",
	description:
		"Manage, publish, and grow your domain portfolio with AI-assisted workflows, supported publishing targets, and operator-facing analytics.",
	openGraph: {
		title: "SmartBeak — AI-Powered Domain Portfolio Management",
		description:
			"Manage, publish, and grow your domain portfolio with AI-assisted workflows, supported publishing targets, and operator-facing analytics.",
	},
};

export default function HomePage() {
	return (
		<main>
			<SmartBeakHero />
			<SmartBeakFeatures />
			<Testimonials />
			<SmartBeakPricing />
			<Suspense
				fallback={
					<div className="flex justify-center py-16">
						<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					</div>
				}
			>
				<WaitlistSection />
			</Suspense>
		</main>
	);
}
