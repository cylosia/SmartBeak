/**
 * Phase 2A — SEO Intelligence Zod schemas.
 * Covers keyword tracking, SEO document updates, GSC/Ahrefs payloads,
 * AI content idea output, and real-time optimizer scoring.
 */

import { z } from "zod";

// ─── Keyword Tracking ─────────────────────────────────────────────────────────

export const KeywordSchema = z.object({
  id: z.string().uuid(),
  domainId: z.string().uuid(),
  keyword: z.string().min(1).max(255),
  volume: z.number().int().nullable(),
  difficulty: z.number().int().min(0).max(100).nullable(),
  position: z.number().int().nullable(),
  decayFactor: z.string().nullable(), // numeric stored as string in drizzle
  lastUpdated: z.date(),
});

export const InsertKeywordSchema = z.object({
  domainId: z.string().uuid(),
  keyword: z.string().min(1).max(255),
  volume: z.number().int().min(0).optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  position: z.number().int().min(1).optional(),
  decayFactor: z.string().optional(),
});

export const UpdateKeywordMetricsSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(1).nullable().optional(),
  volume: z.number().int().min(0).nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
  decayFactor: z.string().nullable().optional(),
});

export const KeywordFilterSchema = z.object({
  organizationSlug: z.string(),
  domainId: z.string().uuid(),
  minVolume: z.number().int().min(0).optional(),
  maxDifficulty: z.number().int().min(0).max(100).optional(),
  hasPosition: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

// ─── SEO Dashboard ────────────────────────────────────────────────────────────

export const SeoDashboardSummarySchema = z.object({
  totalKeywords: z.number().int(),
  avgPosition: z.number().int().nullable(),
  avgDifficulty: z.number().int().nullable(),
  avgVolume: z.number().int().nullable(),
  avgDecay: z.number().int().nullable(),
  topPositionKeywords: z.number().int(),
  decayingKeywords: z.number().int(),
  seoScore: z.number().int(),
  gscConnected: z.boolean(),
  ahrefsConnected: z.boolean(),
});

export const KeywordClusterSchema = z.object({
  cluster: z.string(),
  count: z.number().int(),
  avgPosition: z.number().int().nullable(),
  totalVolume: z.number().int().nullable(),
});

// ─── GSC Integration ──────────────────────────────────────────────────────────

export const GscQueryRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number().int(),
  impressions: z.number().int(),
  ctr: z.number(),
  position: z.number(),
});

export const GscSyncInputSchema = z.object({
  organizationSlug: z.string(),
  domainId: z.string().uuid(),
  siteUrl: z.string().url(),
  accessToken: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GscSyncResultSchema = z.object({
  keywordsImported: z.number().int(),
  keywordsUpdated: z.number().int(),
  seoScoreUpdated: z.boolean(),
});

// ─── Ahrefs Integration ───────────────────────────────────────────────────────

export const AhrefsKeywordRowSchema = z.object({
  keyword: z.string(),
  volume: z.number().int(),
  difficulty: z.number().int(),
  position: z.number().int().nullable(),
  url: z.string().nullable(),
  cpc: z.number().nullable(),
});

export const AhrefsSyncInputSchema = z.object({
  organizationSlug: z.string(),
  domainId: z.string().uuid(),
  apiKey: z.string().min(1),
  target: z.string().min(1),
  mode: z.enum(["domain", "prefix", "exact"]).default("domain"),
  limit: z.number().int().min(1).max(1000).default(100),
});

// ─── AI Content Idea Generator ────────────────────────────────────────────────

export const AiIdeaInputSchema = z.object({
  organizationSlug: z.string(),
  domainId: z.string().uuid(),
  niche: z.string().max(255).optional(),
  targetKeywords: z.array(z.string().max(100)).max(10).optional(),
  contentType: z
    .enum(["article", "listicle", "guide", "case-study", "comparison", "any"])
    .default("any"),
  count: z.number().int().min(1).max(10).default(5),
});

export const AiIdeaSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  outline: z.array(z.string()),
  targetKeywords: z.array(z.string()),
  contentType: z.string(),
  estimatedReadTime: z.number().int(), // minutes
  seoScore: z.number().int().min(0).max(100),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const AiIdeasResponseSchema = z.object({
  ideas: z.array(AiIdeaSchema),
  generatedAt: z.string().datetime(),
});

// ─── Real-time Content Optimizer ─────────────────────────────────────────────

export const ContentOptimizerInputSchema = z.object({
  title: z.string().max(255),
  body: z.string().max(100_000),
  targetKeywords: z.array(z.string().max(100)).max(20).optional(),
  metaDescription: z.string().max(500).optional(),
});

export const ContentOptimizerResultSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  titleScore: z.number().int().min(0).max(100),
  bodyScore: z.number().int().min(0).max(100),
  keywordScore: z.number().int().min(0).max(100),
  readabilityScore: z.number().int().min(0).max(100),
  metaScore: z.number().int().min(0).max(100),
  wordCount: z.number().int(),
  estimatedReadTime: z.number().int(),
  suggestions: z.array(
    z.object({
      type: z.enum(["title", "keyword", "readability", "meta", "structure", "length"]),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
    }),
  ),
  keywordDensity: z.record(z.string(), z.number()),
});

// ─── Decay Alert ─────────────────────────────────────────────────────────────

export const DecayAlertSchema = z.object({
  domainId: z.string().uuid(),
  domainName: z.string(),
  keyword: z.string(),
  decayFactor: z.number(),
  lastUpdated: z.date(),
  alertType: z.enum(["critical", "warning"]),
});
