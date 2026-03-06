import dynamic from "next/dynamic";

const AgentAnalyticsDashboard = dynamic(
	() =>
		import(
			"@/modules/smartbeak/ai-agents/components/AgentAnalyticsDashboard"
		).then((m) => m.AgentAnalyticsDashboard),
	{
		loading: () => (
			<div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="h-28 animate-pulse rounded-xl bg-muted"
					/>
				))}
			</div>
		),
	},
);

interface AnalyticsPageProps {
	params: Promise<{ organizationSlug: string }>;
}

export default async function AnalyticsPage({ params }: AnalyticsPageProps) {
	const { organizationSlug } = await params;
	return <AgentAnalyticsDashboard organizationSlug={organizationSlug} />;
}
