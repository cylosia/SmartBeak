import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { PortfolioRoiDashboard } from "@/modules/smartbeak/analytics-roi/components/PortfolioRoiDashboard";
import { BuyerAttributionView } from "@/modules/smartbeak/analytics-roi/components/BuyerAttributionView";
import { AdvancedAnalyticsOverview } from "@/modules/smartbeak/analytics-roi/components/AdvancedAnalyticsOverview";

export default function AnalyticsPage({
  params,
}: {
  params: { organizationSlug: string };
}) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Advanced Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Portfolio ROI, buyer attribution, and monetization decay insights
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full max-w-lg">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio ROI</TabsTrigger>
          <TabsTrigger value="attribution">Buyer Attribution</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <AdvancedAnalyticsOverview organizationSlug={params.organizationSlug} />
        </TabsContent>

        <TabsContent value="portfolio" className="mt-6">
          <PortfolioRoiDashboard organizationSlug={params.organizationSlug} />
        </TabsContent>

        <TabsContent value="attribution" className="mt-6">
          <BuyerAttributionView organizationSlug={params.organizationSlug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
