import type { Metadata } from "next";
import { ReferralDashboard } from "@/modules/smartbeak/growth/components/ReferralDashboard";

export const metadata: Metadata = {
	title: "Referral Program — SmartBeak",
};

export default function ReferralsPage() {
	return <ReferralDashboard />;
}
