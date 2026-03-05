import { bulkScheduleProcedure } from "./procedures/bulk-schedule";
import {
  bulkRetryDlqProcedure,
  listDlqJobsProcedure,
  listFailedWebhooksProcedure,
  replayWebhookProcedure,
  retryDlqJobProcedure,
} from "./procedures/dlq";
import { createEmailSeriesProcedure } from "./procedures/email-series";
import { executePublishingJobProcedure } from "./procedures/execute-job";
import { getCalendarProcedure } from "./procedures/get-calendar";
import { getPublishAnalyticsProcedure } from "./procedures/get-analytics";
import { getUnifiedDashboardProcedure } from "./procedures/get-unified-dashboard";
import {
  deletePlatformTargetProcedure,
  listPlatformTargetsProcedure,
  togglePlatformTargetProcedure,
  upsertPlatformTargetProcedure,
} from "./procedures/manage-targets";

export const publishingSuiteRouter = {
  // Unified dashboard
  dashboard: getUnifiedDashboardProcedure,
  // Calendar
  calendar: getCalendarProcedure,
  // Bulk scheduling
  bulkSchedule: bulkScheduleProcedure,
  // Job execution (adapter dispatch)
  executeJob: executePublishingJobProcedure,
  // Analytics
  analytics: getPublishAnalyticsProcedure,
  // Email series
  emailSeries: createEmailSeriesProcedure,
  // Platform target management
  targets: {
    list: listPlatformTargetsProcedure,
    upsert: upsertPlatformTargetProcedure,
    toggle: togglePlatformTargetProcedure,
    delete: deletePlatformTargetProcedure,
  },
  // DLQ
  dlq: {
    listJobs: listDlqJobsProcedure,
    retryJob: retryDlqJobProcedure,
    bulkRetry: bulkRetryDlqProcedure,
    listWebhooks: listFailedWebhooksProcedure,
    replayWebhook: replayWebhookProcedure,
  },
};
