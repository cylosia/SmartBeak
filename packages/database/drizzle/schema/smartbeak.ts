// =============================================================================
// SmartBeak v9 — Schema
// =============================================================================
// This file is the single source of truth for the entire SmartBeak project.
// Additive changes (new tables, columns, indexes) are allowed.
// Destructive changes (drops, renames) require a migration plan.
// =============================================================================

import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, pgEnum, numeric, customType, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// bytea custom type — drizzle-orm 0.44.x does not export bytea from pg-core;
// we define it via customType to preserve the exact v9 column type.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// Enums
export const contentStatus = pgEnum('content_status', ['draft', 'published', 'scheduled', 'archived']);
export const domainStatus = pgEnum('domain_status', ['active', 'pending', 'suspended', 'deployed']);
export const publishTarget = pgEnum('publish_target', ['web', 'linkedin', 'facebook', 'instagram', 'youtube', 'wordpress', 'email', 'tiktok', 'pinterest', 'vimeo', 'soundcloud']);
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'editor', 'viewer']);

// 1. Organizations & Members
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').notNull(),
  role: memberRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('org_members_org_id_idx').on(t.orgId),
  index('org_members_user_id_idx').on(t.userId),
]);

// 2. Domains
export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  status: domainStatus('status').default('pending').notNull(),
  themeId: text('theme_id').default('affiliate-comparison').notNull(),
  deployedUrl: text('deployed_url'),
  registryData: jsonb('registry_data'),
  health: jsonb('health'),
  lifecycle: jsonb('lifecycle'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('domains_org_id_idx').on(t.orgId),
]);

// 3. Content
export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  body: text('body'),
  status: contentStatus('status').default('draft').notNull(),
  revisions: jsonb('revisions').default([]),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  index('content_items_domain_id_idx').on(t.domainId),
  index('content_items_domain_deleted_idx').on(t.domainId, t.deletedAt),
]);

export const contentRevisions = pgTable('content_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'cascade' }).notNull(),
  version: integer('version').notNull(),
  body: text('body'),
  changedBy: text('changed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('content_revisions_content_id_idx').on(t.contentId),
]);

// 4. Media
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  fileName: text('file_name').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  size: integer('size'),
  metadata: jsonb('metadata'),
  lifecycle: jsonb('lifecycle'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('media_assets_domain_id_idx').on(t.domainId),
]);

// 5. Publishing
export const publishTargets = pgTable('publish_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  target: publishTarget('target').notNull(),
  encryptedConfig: bytea('encrypted_config').notNull(),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('publish_targets_domain_id_idx').on(t.domainId),
]);

export const publishingJobs = pgTable('publishing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'cascade' }),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  target: publishTarget('target').notNull(),
  status: text('status').default('pending').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('publishing_jobs_domain_id_idx').on(t.domainId),
  index('publishing_jobs_scheduled_idx').on(t.domainId, t.scheduledFor),
]);

export const publishAttempts = pgTable('publish_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => publishingJobs.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').notNull(),
  response: jsonb('response'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('publish_attempts_job_id_idx').on(t.jobId),
]);

// 6. SEO & Keywords
export const seoDocuments = pgTable('seo_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  keywords: jsonb('keywords').default([]),
  gscData: jsonb('gsc_data'),
  ahrefsData: jsonb('ahrefs_data'),
  decaySignals: jsonb('decay_signals'),
  score: integer('score').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('seo_documents_domain_id_idx').on(t.domainId),
]);

export const keywordTracking = pgTable('keyword_tracking', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  keyword: text('keyword').notNull(),
  volume: integer('volume'),
  difficulty: integer('difficulty'),
  position: integer('position'),
  decayFactor: numeric('decay_factor', { precision: 5, scale: 4 }),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('keyword_tracking_domain_id_idx').on(t.domainId),
]);

// 7. Billing & Usage
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  status: text('status').default('active').notNull(),
  plan: text('plan').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('subscriptions_org_id_idx').on(t.orgId),
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  stripeInvoiceId: text('stripe_invoice_id').unique(),
  amountCents: integer('amount_cents').notNull(),
  status: text('status').default('draft').notNull(),
  pdfUrl: text('pdf_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('invoices_org_id_idx').on(t.orgId),
]);

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  metric: text('metric').notNull(),
  value: integer('value').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('usage_records_org_id_idx').on(t.orgId),
]);

export const monetizationDecaySignals = pgTable('monetization_decay_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  decayFactor: numeric('decay_factor', { precision: 5, scale: 4 }).notNull(),
  signalType: text('signal_type').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('decay_signals_domain_id_idx').on(t.domainId),
  index('decay_signals_domain_recorded_idx').on(t.domainId, t.recordedAt),
]);

// 8. SmartDeploy
export const siteShards = pgTable('site_shards', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  version: integer('version').notNull(),
  deployedUrl: text('deployed_url'),
  status: text('status').default('deployed'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('site_shards_domain_id_idx').on(t.domainId),
]);

// 9. Diligence & Portfolio
export const diligenceChecks = pgTable('diligence_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),
  result: jsonb('result'),
  status: text('status').default('pending'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('diligence_checks_domain_id_idx').on(t.domainId),
]);

export const portfolioSummaries = pgTable('portfolio_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  totalDomains: integer('total_domains').default(0),
  totalValue: numeric('total_value', { precision: 15, scale: 2 }),
  avgRoi: numeric('avg_roi', { precision: 5, scale: 2 }),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('portfolio_summaries_org_id_idx').on(t.orgId),
]);

// 10. Audit, Webhooks, Integrations
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('audit_events_org_id_idx').on(t.orgId),
  index('audit_events_org_created_idx').on(t.orgId, t.createdAt),
]);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  processed: boolean('processed').default(false),
  outboxStatus: text('outbox_status').default('pending'),
  replayCount: integer('replay_count').default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('webhook_events_processed_outbox_idx').on(t.processed, t.outboxStatus),
]);

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  encryptedConfig: bytea('encrypted_config').notNull(),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('integrations_org_id_idx').on(t.orgId),
  index('integrations_org_provider_idx').on(t.orgId, t.provider),
  index('integrations_domain_id_idx').on(t.domainId),
]);

// 11. Remaining Tables
export const buyerSessions = pgTable('buyer_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').notNull(),
  buyerEmail: text('buyer_email'),
  intent: text('intent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('buyer_sessions_domain_id_idx').on(t.domainId),
]);

export const timelineEvents = pgTable('timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('timeline_events_domain_id_idx').on(t.domainId),
]);

export const guardrails = pgTable('guardrails', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  rule: text('rule').notNull(),
  value: integer('value').notNull(),
  enabled: boolean('enabled').default(true),
}, (t) => [
  index('guardrails_org_id_idx').on(t.orgId),
]);

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  enabled: boolean('enabled').default(false),
  config: jsonb('config'),
}, (t) => [
  index('feature_flags_org_id_idx').on(t.orgId),
]);

export const onboardingProgress = pgTable('onboarding_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  step: text('step').notNull(),
  completed: boolean('completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('onboarding_progress_org_id_idx').on(t.orgId),
]);

// Relations (add as needed)
export const domainsRelations = relations(domains, ({ many }) => ({
  content: many(contentItems),
  media: many(mediaAssets),
  jobs: many(publishingJobs),
  targets: many(publishTargets),
  seo: many(seoDocuments),
  shards: many(siteShards),
}));
