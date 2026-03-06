import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/tabs";
import dynamic from "next/dynamic";

const AdvancedAnalyticsOverview = dynamic(
	() =>
		import(
			"@/modules/smartbeak/analytics-roi/components/AdvancedAnalyticsOverview"
		).then((m) => m.AdvancedAnalyticsOverview),
	{ loading: () => <AnalyticsSkeleton /> },
);
const PortfolioRoiDashboard = dynamic(
	() =>
		import(
			"@/modules/smartbeak/analytics-roi/components/PortfolioRoiDashboard"
		).then((m) => m.PortfolioRoiDashboard),
	{ loading: () => <AnalyticsSkeleton /> },
);
const BuyerAttributionView = dynamic(
	() =>
		import(
			"@/modules/smartbeak/analytics-roi/components/BuyerAttributionView"
		).then((m) => m.BuyerAttributionView),
	{ loading: () => <AnalyticsSkeleton /> },
);

function AnalyticsSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{Array.from({ length: 4 }).map((_, i) => (
				<div
					key={i}
					className="h-28 animate-pulse rounded-xl bg-muted"
				/>
			))}
		</div>
	);
}

export default async function AnalyticsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;

	return (
		<div className="space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">
					Advanced Analytics
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Portfolio ROI, buyer attribution, and monetization decay
					insights
				</p>
			</div>

			<Tabs defaultValue="overview">
				<TabsList className="w-full max-w-lg">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="portfolio">Portfolio ROI</TabsTrigger>
					<TabsTrigger value="attribution">
						Buyer Attribution
					</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="mt-6">
					<AdvancedAnalyticsOverview
						organizationSlug={organizationSlug}
					/>
				</TabsContent>

				<TabsContent value="portfolio" className="mt-6">
					<PortfolioRoiDashboard
						organizationSlug={organizationSlug}
					/>
				</TabsContent>

				<TabsContent value="attribution" className="mt-6">
					<BuyerAttributionView organizationSlug={organizationSlug} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
