/**
 * SmartBeak v9 — Zod Schemas
 * Generated from the locked v9 schema tables.
 * Used for API input/output validation throughout the application.
 */
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
	auditEvents,
	buyerSessions,
	contentItems,
	contentRevisions,
	diligenceChecks,
	domains,
	featureFlags,
	guardrails,
	integrations,
	invoices,
	keywordTracking,
	mediaAssets,
	monetizationDecaySignals,
	onboardingProgress,
	organizationMembers,
	organizations,
	portfolioSummaries,
	publishAttempts,
	publishingJobs,
	publishTargets,
	seoDocuments,
	siteShards,
	subscriptions,
	timelineEvents,
	usageRecords,
	webhookEvents,
} from "./schema/smartbeak";

// Organizations
export const SmartBeakOrgSchema = createSelectSchema(organizations);
export const SmartBeakOrgInsertSchema = createInsertSchema(organizations);
export type SmartBeakOrg = typeof organizations.$inferSelect;

// Organization Members
export const SmartBeakOrgMemberSchema = createSelectSchema(organizationMembers);
export const SmartBeakOrgMemberInsertSchema =
	createInsertSchema(organizationMembers);
export type SmartBeakOrgMember = typeof organizationMembers.$inferSelect;

// Domains
export const DomainSchema = createSelectSchema(domains);
export const DomainInsertSchema = createInsertSchema(domains);
export type Domain = typeof domains.$inferSelect;

// Content Items
export const ContentItemSchema = createSelectSchema(contentItems);
export const ContentItemInsertSchema = createInsertSchema(contentItems);
export type ContentItem = typeof contentItems.$inferSelect;

// Content Revisions
export const ContentRevisionSchema = createSelectSchema(contentRevisions);
export const ContentRevisionInsertSchema = createInsertSchema(contentRevisions);
export type ContentRevision = typeof contentRevisions.$inferSelect;

// Media Assets
export const MediaAssetSchema = createSelectSchema(mediaAssets);
export const MediaAssetInsertSchema = createInsertSchema(mediaAssets);
export type MediaAsset = typeof mediaAssets.$inferSelect;

// Publish Targets
export const PublishTargetSchema = createSelectSchema(publishTargets);
export const PublishTargetInsertSchema = createInsertSchema(publishTargets);
export type PublishTarget = typeof publishTargets.$inferSelect;

// Publishing Jobs
export const PublishingJobSchema = createSelectSchema(publishingJobs);
export const PublishingJobInsertSchema = createInsertSchema(publishingJobs);
export type PublishingJob = typeof publishingJobs.$inferSelect;

// Publish Attempts
export const PublishAttemptSchema = createSelectSchema(publishAttempts);
export type PublishAttempt = typeof publishAttempts.$inferSelect;

// SEO Documents
export const SeoDocumentSchema = createSelectSchema(seoDocuments);
export const SeoDocumentInsertSchema = createInsertSchema(seoDocuments);
export type SeoDocument = typeof seoDocuments.$inferSelect;

// Keyword Tracking
export const KeywordTrackingSchema = createSelectSchema(keywordTracking);
export const KeywordTrackingInsertSchema = createInsertSchema(keywordTracking);
export type KeywordTracking = typeof keywordTracking.$inferSelect;

// Subscriptions
export const SubscriptionSchema = createSelectSchema(subscriptions);
export type Subscription = typeof subscriptions.$inferSelect;

// Invoices
export const InvoiceSchema = createSelectSchema(invoices);
export type Invoice = typeof invoices.$inferSelect;

// Usage Records
export const UsageRecordSchema = createSelectSchema(usageRecords);
export type UsageRecord = typeof usageRecords.$inferSelect;

// Monetization Decay Signals
export const DecaySignalSchema = createSelectSchema(monetizationDecaySignals);
export type DecaySignal = typeof monetizationDecaySignals.$inferSelect;

// Site Shards
export const SiteShardSchema = createSelectSchema(siteShards);
export type SiteShard = typeof siteShards.$inferSelect;

// Diligence Checks
export const DiligenceCheckSchema = createSelectSchema(diligenceChecks);
export type DiligenceCheck = typeof diligenceChecks.$inferSelect;

// Portfolio Summaries
export const PortfolioSummarySchema = createSelectSchema(portfolioSummaries);
export type PortfolioSummary = typeof portfolioSummaries.$inferSelect;

// Audit Events
export const AuditEventSchema = createSelectSchema(auditEvents);
export type AuditEvent = typeof auditEvents.$inferSelect;

// Webhook Events
export const WebhookEventSchema = createSelectSchema(webhookEvents);
export type WebhookEvent = typeof webhookEvents.$inferSelect;

// Integrations
export const IntegrationSchema = createSelectSchema(integrations);
export type Integration = typeof integrations.$inferSelect;

// Buyer Sessions
export const BuyerSessionSchema = createSelectSchema(buyerSessions);
export type BuyerSession = typeof buyerSessions.$inferSelect;

// Timeline Events
export const TimelineEventSchema = createSelectSchema(timelineEvents);
export type TimelineEvent = typeof timelineEvents.$inferSelect;

// Guardrails
export const GuardrailSchema = createSelectSchema(guardrails);
export type Guardrail = typeof guardrails.$inferSelect;

// Feature Flags
export const FeatureFlagSchema = createSelectSchema(featureFlags);
export type FeatureFlag = typeof featureFlags.$inferSelect;

// Onboarding Progress
export const OnboardingProgressSchema = createSelectSchema(onboardingProgress);
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;

// ─── API Input Schemas (used in oRPC procedures) ──────────────────────────────

export const CreateDomainInputSchema = z.object({
	name: z.string().min(1).max(255),
	slug: z
		.string()
		.min(1)
		.max(255)
		.regex(/^[a-z0-9-]+$/),
	themeId: z.string().optional(),
});

export const UpdateDomainInputSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(255).optional(),
	status: z.enum(["active", "pending", "suspended", "deployed"]).optional(),
	themeId: z.string().optional(),
	deployedUrl: z.string().url().nullable().optional(),
	registryData: z.record(z.string(), z.unknown()).nullable().optional(),
	health: z.record(z.string(), z.unknown()).nullable().optional(),
	lifecycle: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const CreateContentItemInputSchema = z.object({
	domainId: z.string().uuid(),
	title: z.string().min(1).max(500),
	body: z.string().optional(),
	status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
	scheduledFor: z.string().datetime().nullable().optional(),
});

export const UpdateContentItemInputSchema = z.object({
	id: z.string().uuid(),
	title: z.string().min(1).max(500).optional(),
	body: z.string().optional(),
	status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
	scheduledFor: z.string().datetime().nullable().optional(),
});

export const CreatePublishingJobInputSchema = z.object({
	contentId: z.string().uuid().optional(),
	domainId: z.string().uuid(),
	target: z.enum([
		"web",
		"linkedin",
		"facebook",
		"instagram",
		"youtube",
		"wordpress",
		"email",
		"tiktok",
		"pinterest",
		"vimeo",
		"soundcloud",
	]),
	scheduledFor: z.string().datetime().nullable().optional(),
});

export const UpsertSeoDocumentInputSchema = z.object({
	domainId: z.string().uuid(),
	keywords: z.array(z.string()).optional(),
	score: z.number().int().min(0).max(100).optional(),
});

export const AddKeywordInputSchema = z.object({
	domainId: z.string().uuid(),
	keyword: z.string().min(1).max(255),
	volume: z.number().int().optional(),
	difficulty: z.number().int().min(0).max(100).optional(),
	position: z.number().int().optional(),
});

export const UpsertFeatureFlagInputSchema = z.object({
	orgId: z.string().uuid(),
	key: z.string().min(1).max(100),
	enabled: z.boolean().optional(),
	config: z.record(z.string(), z.unknown()).optional(),
});

export const UpsertGuardrailInputSchema = z.object({
	orgId: z.string().uuid(),
	rule: z.string().min(1).max(100),
	value: z.number().int(),
	enabled: z.boolean().optional(),
});

export const CompleteOnboardingStepInputSchema = z.object({
	orgId: z.string().uuid(),
	step: z.string().min(1).max(100),
});
