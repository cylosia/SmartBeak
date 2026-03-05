/**
 * Phase 2B — Full Publishing Suite Zod Schemas
 */
import { z } from "zod";

export const PUBLISH_TARGETS = [
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
] as const;

export type PublishTarget = (typeof PUBLISH_TARGETS)[number];

export const publishTargetSchema = z.enum(PUBLISH_TARGETS);

// ─── Platform Configs ─────────────────────────────────────────────────────────

export const linkedinConfigSchema = z.object({
  accessToken: z.string().min(1),
  organizationUrn: z.string().optional(),
});

export const youtubeConfigSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  channelId: z.string().min(1),
  privacyStatus: z.enum(["public", "unlisted", "private"]).default("public"),
});

export const tiktokConfigSchema = z.object({
  accessToken: z.string().min(1),
  openId: z.string().min(1),
});

export const instagramConfigSchema = z.object({
  accessToken: z.string().min(1),
  igUserId: z.string().min(1),
});

export const pinterestConfigSchema = z.object({
  accessToken: z.string().min(1),
  boardId: z.string().min(1),
});

export const vimeoConfigSchema = z.object({
  accessToken: z.string().min(1),
  privacy: z.enum(["anybody", "nobody", "password", "unlisted"]).default("anybody"),
});

export const emailConfigSchema = z.object({
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional(),
  audienceId: z.string().optional(),
});

export const webConfigSchema = z.object({
  theme: z.string().default("default"),
  customDomain: z.string().optional(),
});

export const platformConfigSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("linkedin"), config: linkedinConfigSchema }),
  z.object({ target: z.literal("youtube"), config: youtubeConfigSchema }),
  z.object({ target: z.literal("tiktok"), config: tiktokConfigSchema }),
  z.object({ target: z.literal("instagram"), config: instagramConfigSchema }),
  z.object({ target: z.literal("pinterest"), config: pinterestConfigSchema }),
  z.object({ target: z.literal("vimeo"), config: vimeoConfigSchema }),
  z.object({ target: z.literal("email"), config: emailConfigSchema }),
  z.object({ target: z.literal("web"), config: webConfigSchema }),
  z.object({ target: z.literal("facebook"), config: z.object({ accessToken: z.string(), pageId: z.string() }) }),
  z.object({ target: z.literal("wordpress"), config: z.object({ siteUrl: z.string().url(), username: z.string(), appPassword: z.string() }) }),
  z.object({ target: z.literal("soundcloud"), config: z.object({ accessToken: z.string() }) }),
]);

// ─── Bulk Scheduling ──────────────────────────────────────────────────────────

export const bulkScheduleItemSchema = z.object({
  contentId: z.string().uuid().optional(),
  target: publishTargetSchema,
  scheduledFor: z.string().datetime(),
});

export const bulkScheduleInputSchema = z.object({
  organizationSlug: z.string().min(1),
  domainId: z.string().uuid(),
  jobs: z.array(bulkScheduleItemSchema).min(1).max(100),
});

// ─── Email Series ─────────────────────────────────────────────────────────────

export const emailSeriesStepSchema = z.object({
  subject: z.string().min(1).max(255),
  htmlBody: z.string().min(1),
  delayDays: z.number().int().min(0).max(365),
  contentId: z.string().uuid().optional(),
});

export const emailSeriesInputSchema = z.object({
  organizationSlug: z.string().min(1),
  domainId: z.string().uuid(),
  seriesName: z.string().min(1).max(255),
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional(),
  steps: z.array(emailSeriesStepSchema).min(1).max(52),
  startAt: z.string().datetime().optional(),
});

// ─── Analytics ────────────────────────────────────────────────────────────────

export const publishAnalyticsRowSchema = z.object({
  jobId: z.string().uuid(),
  target: publishTargetSchema,
  contentId: z.string().uuid().nullable(),
  attemptedAt: z.date(),
  views: z.number().int().min(0),
  engagement: z.number().int().min(0),
  clicks: z.number().int().min(0),
  impressions: z.number().int().min(0),
  platformPostId: z.string().nullable(),
});

// ─── DLQ / Retry ─────────────────────────────────────────────────────────────

export const dlqJobSchema = z.object({
  id: z.string().uuid(),
  domainId: z.string().uuid(),
  contentId: z.string().uuid().nullable(),
  target: publishTargetSchema,
  status: z.string(),
  error: z.string().nullable(),
  createdAt: z.date(),
  attemptCount: z.number().int(),
});

// ─── Unified Dashboard ────────────────────────────────────────────────────────

export const unifiedJobSchema = z.object({
  id: z.string().uuid(),
  domainId: z.string().uuid(),
  domainName: z.string().optional(),
  contentId: z.string().uuid().nullable(),
  contentTitle: z.string().optional(),
  target: publishTargetSchema,
  status: z.string(),
  scheduledFor: z.date().nullable(),
  executedAt: z.date().nullable(),
  error: z.string().nullable(),
  createdAt: z.date(),
  attemptCount: z.number().int(),
});
