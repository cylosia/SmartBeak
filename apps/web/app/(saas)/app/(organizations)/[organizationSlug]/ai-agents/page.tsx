import { AgentManagementDashboard } from "@/modules/smartbeak/ai-agents/components/AgentManagementDashboard";

interface AiAgentsPageProps {
  params: { organizationSlug: string };
}

export default function AiAgentsPage({ params }: AiAgentsPageProps) {
  return (
    <AgentManagementDashboard organizationSlug={params.organizationSlug} />
  );
}
