import { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { affiliateRoutes } from '../routes/affiliates';
import { analyticsRoutes } from '../routes/analytics';
import { attributionRoutes } from '../routes/attribution';
import { billingInvoiceRoutes } from '../routes/billing-invoices';
import { billingRoutes } from '../routes/billing';
import { cacheRoutes } from '../routes/cache';
import { contentRevisionRoutes } from '../routes/content-revisions';
import { contentRoutes } from '../routes/content';
import { contentScheduleRoutes } from '../routes/content-schedule';
import { diligenceRoutes } from '../routes/diligence';
import { domainDetailsRoutes } from '../routes/domain-details';
import { domainOwnershipRoutes } from '../routes/domain-ownership';
import { domainRoutes } from '../routes/domains';
import { guardrailRoutes } from '../routes/guardrails';
import { llmRoutes } from '../routes/llm';
import { mediaLifecycleRoutes } from '../routes/media-lifecycle';
import { mediaRoutes } from '../routes/media';
import { notificationAdminRoutes } from '../routes/notifications-admin';
import { notificationRoutes } from '../routes/notifications';
import { onboardingRoutes } from '../routes/onboarding';
import { orgRoutes } from '../routes/orgs';
import { planningRoutes } from '../routes/planning';
import { portfolioRoutes } from '../routes/portfolio';
import { publishingCreateJobRoutes } from '../routes/publishing-create-job';
import { publishingPreviewRoutes } from '../routes/publishing-preview';
import { publishingRoutes } from '../routes/publishing';
import { queueMetricsRoutes } from '../routes/queue-metrics';
import { queueRoutes } from '../routes/queues';
import { registerAppsApiRoutes } from '../routes/apps-api-routes';
import { roiRiskRoutes } from '../routes/roi-risk';
import { searchRoutes } from '../routes/search';
import { seoRoutes } from '../routes/seo';
import { themeRoutes } from '../routes/themes';
import { timelineRoutes } from '../routes/timeline';
import { usageRoutes } from '../routes/usage';

/**
 * V1 API routes plugin.
 *
 * All business routes are registered under the /v1 prefix via Fastify's
 * encapsulated plugin system. Infrastructure routes (/health, /readyz,
 * /livez) remain at the root level in http.ts.
 *
 * Deprecation strategy: when v2 is introduced, create a v2-routes.ts plugin
 * and add Deprecation + Sunset headers to this plugin's onSend hook.
 */
export async function v1Routes(app: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;

  // Add API version header to all v1 responses
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-API-Version', '1');
    return payload;
  });

  // Core routes
  await planningRoutes(app, pool);
  await contentRoutes(app, pool);
  await domainRoutes(app, pool);
  await billingRoutes(app, pool);
  await orgRoutes(app, pool);
  await onboardingRoutes(app, pool);
  await notificationRoutes(app, pool);
  await searchRoutes(app, pool);
  await usageRoutes(app, pool);
  await seoRoutes(app, pool);
  await analyticsRoutes(app, pool);
  await publishingRoutes(app, pool);
  await mediaRoutes(app, pool);
  await queueRoutes(app, pool);

  // Additional routes
  // C3-FIX: Removed contentListRoutes — it registered a duplicate GET /content that conflicted
  // with contentRoutes above. The content.ts handler is the canonical one.
  await contentRevisionRoutes(app, pool);
  await contentScheduleRoutes(app);
  await domainOwnershipRoutes(app, pool);
  await guardrailRoutes(app, pool);
  await mediaLifecycleRoutes(app, pool);
  await notificationAdminRoutes(app, pool);
  await publishingCreateJobRoutes(app, pool);
  await publishingPreviewRoutes(app, pool);
  await queueMetricsRoutes(app, pool);
  await cacheRoutes(app, pool);

  // New routes to fix missing API endpoints
  await affiliateRoutes(app, pool);
  await diligenceRoutes(app, pool);
  await attributionRoutes(app, pool);
  await timelineRoutes(app, pool);
  await domainDetailsRoutes(app, pool);
  await themeRoutes(app, pool);
  await roiRiskRoutes(app, pool);
  await portfolioRoutes(app, pool);
  await llmRoutes(app, pool);
  await billingInvoiceRoutes(app, pool);

  // Migrated routes from apps/api/src/routes/
  await registerAppsApiRoutes(app, pool);
}
