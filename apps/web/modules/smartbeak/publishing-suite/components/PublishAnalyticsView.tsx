"use client";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { BarChart2Icon } from "lucide-react";
import { EmptyState } from "@/modules/smartbeak/shared/components/EmptyState";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";

export function PublishAnalyticsView(_: {
	organizationSlug: string;
	domainId: string;
}) {
	return (
		<ErrorBoundary>
			<div className="space-y-6">
				<Card className="border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20">
					<CardHeader>
						<CardTitle className="text-base text-amber-900 dark:text-amber-100">
							Publishing analytics unavailable
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-amber-800 dark:text-amber-200">
						Current publishing adapters only persist publish IDs and
						destination URLs. They do not ingest post-performance
						metrics like views, clicks, engagement, or impressions, so
						reporting from this screen is disabled until adapter
						analytics
						collection exists.
					</CardContent>
				</Card>

				<EmptyState
					icon={BarChart2Icon}
					title="No publish analytics available"
					description="Publishing status remains available in the dashboard and DLQ, but post-publish performance reporting is not implemented yet."
				/>
			</div>
		</ErrorBoundary>
	);
}
