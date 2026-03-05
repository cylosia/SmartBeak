import { AgentManagementDashboard } from "@/modules/smartbeak/ai-agents/components/AgentManagementDashboard";

interface AiAgentsPageProps {
  params: Promise<{ organizationSlug: string }>;
}

export default async function AiAgentsPage({ params }: AiAgentsPageProps) {
  const { organizationSlug } = await params;
  return <AgentManagementDashboard organizationSlug={organizationSlug} />;
}
