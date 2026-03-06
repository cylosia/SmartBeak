import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/tabs";
import { ActivityIcon, AlertTriangleIcon } from "lucide-react";
import { DLQView } from "@/modules/smartbeak/publishing-suite/components/DLQView";
import { UnifiedPublishingDashboard } from "@/modules/smartbeak/publishing-suite/components/UnifiedPublishingDashboard";

export const metadata = { title: "Publishing Suite" };

export default async function PublishingSuitePage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;

	return (
		<div className="space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">
					Publishing Suite
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Unified view of all publishing activity across every domain
					and platform.
				</p>
			</div>

			<Tabs defaultValue="dashboard">
				<TabsList>
					<TabsTrigger value="dashboard" className="gap-1.5">
						<ActivityIcon className="h-3.5 w-3.5" />
						Dashboard
					</TabsTrigger>
					<TabsTrigger value="dlq" className="gap-1.5">
						<AlertTriangleIcon className="h-3.5 w-3.5" />
						Dead-Letter Queue
					</TabsTrigger>
				</TabsList>

				<TabsContent value="dashboard" className="mt-6">
					<UnifiedPublishingDashboard
						organizationSlug={organizationSlug}
					/>
				</TabsContent>

				<TabsContent value="dlq" className="mt-6">
					<DLQView organizationSlug={organizationSlug} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
