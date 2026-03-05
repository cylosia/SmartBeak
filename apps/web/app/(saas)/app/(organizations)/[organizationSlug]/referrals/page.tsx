import { ReferralDashboard } from "@/modules/smartbeak/growth/components/ReferralDashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Referral Program — SmartBeak",
};

export default function ReferralsPage() {
  return <ReferralDashboard />;
}
