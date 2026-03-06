import { WorkflowBuilder } from "@/modules/smartbeak/ai-agents/components/WorkflowBuilder";

interface WorkflowBuilderPageProps {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
}

export default async function WorkflowBuilderPage({
	params,
}: WorkflowBuilderPageProps) {
	const { organizationSlug, workflowId } = await params;
	return (
		<div className="h-[calc(100vh-220px)]">
			<WorkflowBuilder
				organizationSlug={organizationSlug}
				workflowId={workflowId}
			/>
		</div>
	);
}
