import { AgentAnalyticsDashboard } from "@/modules/smartbeak/ai-agents/components/AgentAnalyticsDashboard";

interface AnalyticsPageProps {
  params: Promise<{ organizationSlug: string }>;
}

export default async function AnalyticsPage({ params }: AnalyticsPageProps) {
  const { organizationSlug } = await params;
  return <AgentAnalyticsDashboard organizationSlug={organizationSlug} />;
}
