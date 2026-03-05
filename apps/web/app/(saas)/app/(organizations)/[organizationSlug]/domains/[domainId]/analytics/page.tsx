import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { DiligenceEngineView } from "@/modules/smartbeak/analytics-roi/components/DiligenceEngineView";
import { SellReadyPanel } from "@/modules/smartbeak/analytics-roi/components/SellReadyPanel";
import { BuyerAttributionView } from "@/modules/smartbeak/analytics-roi/components/BuyerAttributionView";

export default async function DomainAnalyticsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; domainId: string }>;
}) {
  const { organizationSlug, domainId } = await params;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domain Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diligence engine, sell-ready score, and buyer attribution for this domain
        </p>
      </div>

      <Tabs defaultValue="diligence">
        <TabsList className="w-full max-w-lg">
          <TabsTrigger value="diligence">Diligence Engine</TabsTrigger>
          <TabsTrigger value="sell-ready">Sell-Ready Score</TabsTrigger>
          <TabsTrigger value="attribution">Buyer Attribution</TabsTrigger>
        </TabsList>

        <TabsContent value="diligence" className="mt-6">
          <DiligenceEngineView
            organizationSlug={organizationSlug}
            domainId={domainId}
          />
        </TabsContent>

        <TabsContent value="sell-ready" className="mt-6">
          <SellReadyPanel
            organizationSlug={organizationSlug}
            domainId={domainId}
          />
        </TabsContent>

        <TabsContent value="attribution" className="mt-6">
          <BuyerAttributionView
            organizationSlug={organizationSlug}
            domainId={domainId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
