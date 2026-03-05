import { AgentAnalyticsDashboard } from "@/modules/smartbeak/ai-agents/components/AgentAnalyticsDashboard";

interface AnalyticsPageProps {
  params: { organizationSlug: string };
}

export default function AnalyticsPage({ params }: AnalyticsPageProps) {
  return (
    <AgentAnalyticsDashboard organizationSlug={params.organizationSlug} />
  );
}
