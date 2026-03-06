/**
 * Phase 2C — Advanced Analytics & ROI Zod Schemas
 */
import { z } from "zod";

// ─── Portfolio ROI ────────────────────────────────────────────────────────────

export const DomainRoiSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	healthScore: z.number().nullable(),
	status: z.string().nullable(),
	createdAt: z.date(),
	riskAdjustedScore: z.number(),
	decayFactor: z.number(),
	estimatedValue: z.number(),
});

export const PortfolioRoiResponseSchema = z.object({
	summary: z
		.object({
			id: z.string().uuid(),
			orgId: z.string().uuid(),
			totalDomains: z.number().nullable(),
			totalValue: z.string().nullable(),
			avgRoi: z.string().nullable(),
			lastUpdated: z.date().nullable(),
		})
		.nullable(),
	domains: z.array(DomainRoiSchema),
	totalValue: z.number(),
	avgRoi: z.number(),
	totalDomains: z.number(),
});

// ─── Diligence ────────────────────────────────────────────────────────────────

export const DiligenceCheckSchema = z.object({
	id: z.string().uuid(),
	domainId: z.string().uuid(),
	type: z.string(),
	result: z.record(z.string(), z.unknown()).nullable(),
	status: z.string().nullable(),
	completedAt: z.date().nullable(),
});

export const DiligenceReportSchema = z.object({
	checks: z.array(DiligenceCheckSchema),
	total: z.number(),
	passed: z.number(),
	failed: z.number(),
	pending: z.number(),
	score: z.number().min(0).max(100),
	byType: z.record(z.string(), z.array(DiligenceCheckSchema)),
});

export const RunDiligenceInputSchema = z.object({
	organizationSlug: z.string().min(1),
	domainId: z.string().uuid(),
});

// ─── Sell-Ready Score ─────────────────────────────────────────────────────────

export const SellReadyRecommendationSchema = z.object({
	area: z.string(),
	message: z.string(),
	priority: z.enum(["high", "medium", "low"]),
});

export const SellReadyScoreResponseSchema = z.object({
	score: z.number().min(0).max(100),
	breakdown: z.object({
		health: z.number(),
		diligence: z.number(),
		monetization: z.number(),
		buyerInterest: z.number(),
		timelineActivity: z.number(),
	}),
	recommendations: z.array(SellReadyRecommendationSchema),
	avgDecay: z.number(),
	buyerSessionCount: z.number(),
});

// ─── Buyer Attribution ────────────────────────────────────────────────────────

export const BuyerSessionSchema = z.object({
	id: z.string().uuid(),
	domainId: z.string().uuid(),
	sessionId: z.string(),
	buyerEmail: z.string().nullable(),
	intent: z.string().nullable(),
	createdAt: z.date(),
});

export const BuyerAttributionResponseSchema = z.object({
	sessions: z.array(BuyerSessionSchema),
	total: z.number(),
	converted: z.number(),
	conversionRate: z.number(),
	intentBreakdown: z.array(
		z.object({ intent: z.string(), count: z.number() }),
	),
	dailyTrend: z.array(z.object({ date: z.string(), count: z.number() })),
});

export const CreateBuyerSessionInputSchema = z.object({
	organizationSlug: z.string().min(1),
	domainId: z.string().uuid(),
	sessionId: z.string().min(1),
	buyerEmail: z.string().email().optional(),
	intent: z.string().optional(),
});

// ─── Monetization Decay ───────────────────────────────────────────────────────

export const DecaySignalSchema = z.object({
	id: z.string().uuid(),
	domainId: z.string().uuid(),
	decayFactor: z.string(),
	signalType: z.string(),
	recordedAt: z.date(),
});

export const DomainDecayAnalyticsSchema = z.object({
	domain: z.object({
		id: z.string().uuid(),
		name: z.string(),
		healthScore: z.number().nullable(),
	}),
	signals: z.array(DecaySignalSchema),
	avgDecay: z.number(),
});

// ─── Portfolio Trend ──────────────────────────────────────────────────────────

export const PortfolioTrendPointSchema = z.object({
	date: z.string(),
	avgDecay: z.number(),
});

// ─── Input Schemas ────────────────────────────────────────────────────────────

export const OrgSlugInputSchema = z.object({
	organizationSlug: z.string().min(1),
});

export const DomainAnalyticsInputSchema = z.object({
	organizationSlug: z.string().min(1),
	domainId: z.string().uuid(),
});

export const PortfolioTrendInputSchema = z.object({
	organizationSlug: z.string().min(1),
	days: z.number().int().min(7).max(365).default(30),
});
