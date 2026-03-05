"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Button } from "@repo/ui/components/button";
import { PublishingCalendar } from "@/modules/smartbeak/publishing-suite/components/PublishingCalendar";
import { PublishAnalyticsView } from "@/modules/smartbeak/publishing-suite/components/PublishAnalyticsView";
import { EmailSeriesBuilder } from "@/modules/smartbeak/publishing-suite/components/EmailSeriesBuilder";
import { BulkScheduleDialog } from "@/modules/smartbeak/publishing-suite/components/BulkScheduleDialog";
import { PlatformTargetsManager } from "@/modules/smartbeak/publishing-suite/components/PlatformTargetsManager";
import {
  CalendarIcon,
  BarChart2Icon,
  MailIcon,
  SettingsIcon,
  PlusIcon,
} from "lucide-react";

export default function DomainPublishingSuitePage() {
  const params = useParams<{ organizationSlug: string; domainId: string }>();
  const { organizationSlug, domainId } = params;
  const [emailBuilderOpen, setEmailBuilderOpen] = useState(false);
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publishing Suite</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Schedule, publish, and track content across all connected platforms.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setEmailBuilderOpen(true)}
          >
            <MailIcon className="h-4 w-4" />
            Email Series
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setBulkScheduleOpen(true)}
          >
            <PlusIcon className="h-4 w-4" />
            Bulk Schedule
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart2Icon className="h-3.5 w-3.5" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="platforms" className="gap-1.5">
            <SettingsIcon className="h-3.5 w-3.5" />
            Platforms
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-6">
          <PublishingCalendar organizationSlug={organizationSlug} domainId={domainId} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <PublishAnalyticsView organizationSlug={organizationSlug} domainId={domainId} />
        </TabsContent>

        <TabsContent value="platforms" className="mt-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Connected Platforms</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure API credentials for each publishing platform. Credentials are encrypted at rest.
            </p>
          </div>
          <PlatformTargetsManager organizationSlug={organizationSlug} domainId={domainId} />
        </TabsContent>
      </Tabs>

      <EmailSeriesBuilder
        organizationSlug={organizationSlug}
        domainId={domainId}
        open={emailBuilderOpen}
        onClose={() => setEmailBuilderOpen(false)}
      />

      <BulkScheduleDialog
        organizationSlug={organizationSlug}
        domainId={domainId}
        open={bulkScheduleOpen}
        onClose={() => setBulkScheduleOpen(false)}
      />
    </div>
  );
}
