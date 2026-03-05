import { WorkflowBuilder } from "@/modules/smartbeak/ai-agents/components/WorkflowBuilder";

interface WorkflowBuilderPageProps {
  params: { organizationSlug: string; workflowId: string };
}

export default function WorkflowBuilderPage({
  params,
}: WorkflowBuilderPageProps) {
  return (
    <div className="h-[calc(100vh-220px)]">
      <WorkflowBuilder
        organizationSlug={params.organizationSlug}
        workflowId={params.workflowId}
      />
    </div>
  );
}
