/**
 * SmartBeak Phase 3A — Enterprise Readiness & Scaling Zod schemas.
 *
 * All schemas use strict Zod v4 validation and are the single source of
 * truth for input/output validation across the API and frontend.
 */

import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const EnterpriseTeamRoleSchema = z.enum(["admin", "member"]);
export type EnterpriseTeamRole = z.infer<typeof EnterpriseTeamRoleSchema>;

export const EnterpriseSsoTypeSchema = z.enum(["saml", "oidc"]);
export type EnterpriseSsoType = z.infer<typeof EnterpriseSsoTypeSchema>;

export const EnterpriseSsoStatusSchema = z.enum([
	"active",
	"inactive",
	"testing",
]);
export type EnterpriseSsoStatus = z.infer<typeof EnterpriseSsoStatusSchema>;

export const EnterpriseBillingIntervalSchema = z.enum(["monthly", "annual"]);
export type EnterpriseBillingInterval = z.infer<
	typeof EnterpriseBillingIntervalSchema
>;

// ─── Teams ────────────────────────────────────────────────────────────────────

export const EnterpriseTeamSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	name: z.string().min(1).max(100),
	slug: z.string().min(1).max(100),
	description: z.string().max(500).nullable(),
	settings: z.record(z.string(), z.unknown()).nullable(),
	createdBy: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type EnterpriseTeam = z.infer<typeof EnterpriseTeamSchema>;

export const CreateTeamInputSchema = z.object({
	organizationSlug: z.string().min(1),
	name: z.string().min(1, "Team name is required").max(100),
	description: z.string().max(500).optional(),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

export const UpdateTeamInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).nullable().optional(),
	settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTeamInput = z.infer<typeof UpdateTeamInputSchema>;

export const DeleteTeamInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
});

export const ListTeamsInputSchema = z.object({
	organizationSlug: z.string().min(1),
});

export const EnterpriseTeamMemberSchema = z.object({
	id: z.string().uuid(),
	teamId: z.string().uuid(),
	userId: z.string(),
	role: EnterpriseTeamRoleSchema,
	invitedBy: z.string().nullable(),
	createdAt: z.date(),
	/** Denormalized user info for display. */
	user: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string().email(),
			image: z.string().nullable(),
		})
		.optional(),
});
export type EnterpriseTeamMember = z.infer<typeof EnterpriseTeamMemberSchema>;

export const AddTeamMemberInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
	userId: z.string().min(1),
	role: EnterpriseTeamRoleSchema.default("member"),
});
export type AddTeamMemberInput = z.infer<typeof AddTeamMemberInputSchema>;

export const RemoveTeamMemberInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
	userId: z.string().min(1),
});

export const UpdateTeamMemberRoleInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
	userId: z.string().min(1),
	role: EnterpriseTeamRoleSchema,
});

export const EnterpriseTeamActivitySchema = z.object({
	id: z.string().uuid(),
	teamId: z.string().uuid(),
	actorId: z.string(),
	action: z.string(),
	entityType: z.string().nullable(),
	entityId: z.string().nullable(),
	details: z.record(z.string(), z.unknown()).nullable(),
	createdAt: z.date(),
});
export type EnterpriseTeamActivity = z.infer<
	typeof EnterpriseTeamActivitySchema
>;

export const ListTeamActivityInputSchema = z.object({
	organizationSlug: z.string().min(1),
	teamId: z.string().uuid(),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

// ─── SSO & SCIM ───────────────────────────────────────────────────────────────

export const SamlConfigSchema = z.object({
	entityId: z.string().min(1, "IdP Entity ID is required"),
	ssoUrl: z.string().url("SSO URL must be a valid URL"),
	certificate: z.string().min(1, "X.509 certificate is required"),
	spEntityId: z.string().min(1, "SP Entity ID is required"),
	spAcsUrl: z.string().url("ACS URL must be a valid URL"),
});
export type SamlConfig = z.infer<typeof SamlConfigSchema>;

export const OidcConfigSchema = z.object({
	issuer: z.string().url("Issuer must be a valid URL"),
	clientId: z.string().min(1, "Client ID is required"),
	clientSecret: z.string().min(1, "Client Secret is required"),
	redirectUri: z.string().url("Redirect URI must be a valid URL"),
	scopes: z.array(z.string()).default(["openid", "email", "profile"]),
});
export type OidcConfig = z.infer<typeof OidcConfigSchema>;

export const EnterpriseSsoProviderSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	type: EnterpriseSsoTypeSchema,
	status: EnterpriseSsoStatusSchema,
	domain: z.string().min(1),
	providerName: z.string().nullable(),
	/** Non-sensitive display metadata only — never includes secrets. */
	metadata: z.record(z.string(), z.unknown()).nullable(),
	createdBy: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type EnterpriseSsoProvider = z.infer<typeof EnterpriseSsoProviderSchema>;

export const UpsertSsoProviderInputSchema = z.discriminatedUnion("type", [
	z.object({
		organizationSlug: z.string().min(1),
		type: z.literal("saml"),
		domain: z
			.string()
			.min(1)
			.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Must be a valid domain"),
		providerName: z.string().max(100).optional(),
		config: SamlConfigSchema,
	}),
	z.object({
		organizationSlug: z.string().min(1),
		type: z.literal("oidc"),
		domain: z
			.string()
			.min(1)
			.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Must be a valid domain"),
		providerName: z.string().max(100).optional(),
		config: OidcConfigSchema,
	}),
]);
export type UpsertSsoProviderInput = z.infer<
	typeof UpsertSsoProviderInputSchema
>;

export const DeleteSsoProviderInputSchema = z.object({
	organizationSlug: z.string().min(1),
	providerId: z.string().uuid(),
});

export const UpdateSsoStatusInputSchema = z.object({
	organizationSlug: z.string().min(1),
	providerId: z.string().uuid(),
	status: EnterpriseSsoStatusSchema,
});

export const EnterpriseScimTokenSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	description: z.string().nullable(),
	tokenSuffix: z.string().length(4),
	lastUsedAt: z.date().nullable(),
	expiresAt: z.date().nullable(),
	createdBy: z.string(),
	createdAt: z.date(),
});
export type EnterpriseScimToken = z.infer<typeof EnterpriseScimTokenSchema>;

export const CreateScimTokenSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	description: z.string().nullable(),
	tokenSuffix: z.string().length(4),
	lastUsedAt: z.date().nullable(),
	expiresAt: z.date().nullable(),
	createdBy: z.string(),
	createdAt: z.date(),
	/** Raw token — only returned once at creation time. */
	rawToken: z.string(),
});
export type CreateScimToken = z.infer<typeof CreateScimTokenSchema>;

export const CreateScimTokenInputSchema = z.object({
	organizationSlug: z.string().min(1),
	description: z.string().max(200).optional(),
	expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const DeleteScimTokenInputSchema = z.object({
	organizationSlug: z.string().min(1),
	tokenId: z.string().uuid(),
});

// ─── Audit Retention ──────────────────────────────────────────────────────────

export const EnterpriseAuditRetentionSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	retentionDays: z.number().int().min(30).max(2555),
	exportEnabled: z.boolean(),
	exportSchedule: z.string().nullable(),
	exportRecipients: z.string().nullable(),
	updatedBy: z.string().nullable(),
	updatedAt: z.date(),
});
export type EnterpriseAuditRetention = z.infer<
	typeof EnterpriseAuditRetentionSchema
>;

export const SetAuditRetentionInputSchema = z.object({
	organizationSlug: z.string().min(1),
	retentionDays: z
		.number()
		.int()
		.min(30, "Minimum retention is 30 days")
		.max(2555, "Maximum retention is 7 years (2555 days)"),
	exportEnabled: z.boolean().default(false),
	exportSchedule: z
		.string()
		.regex(
			/^(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)$/,
			"Must be a valid cron expression",
		)
		.optional(),
	exportRecipients: z.string().max(1000).optional(),
});
export type SetAuditRetentionInput = z.infer<
	typeof SetAuditRetentionInputSchema
>;

export const SearchAuditLogsInputSchema = z.object({
	organizationSlug: z.string().min(1),
	query: z.string().max(200).optional(),
	entityType: z.string().max(100).optional(),
	actorId: z.string().max(100).optional(),
	action: z.string().max(100).optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	limit: z.number().int().min(1).max(500).default(50),
	offset: z.number().int().min(0).default(0),
});
export type SearchAuditLogsInput = z.infer<typeof SearchAuditLogsInputSchema>;

export const ExportAuditLogsInputSchema = z.object({
	organizationSlug: z.string().min(1),
	format: z.enum(["csv", "json"]).default("csv"),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	entityType: z.string().max(100).optional(),
});
export type ExportAuditLogsInput = z.infer<typeof ExportAuditLogsInputSchema>;

// ─── Billing Tiers ────────────────────────────────────────────────────────────

export const EnterpriseTierFeaturesSchema = z.object({
	sso: z.boolean().default(false),
	scim: z.boolean().default(false),
	advancedAudit: z.boolean().default(false),
	customRoles: z.boolean().default(false),
	prioritySupport: z.boolean().default(false),
	sla: z.boolean().default(false),
	dedicatedCsm: z.boolean().default(false),
	customContracts: z.boolean().default(false),
});
export type EnterpriseTierFeatures = z.infer<
	typeof EnterpriseTierFeaturesSchema
>;

export const EnterpriseTierLimitsSchema = z.object({
	seats: z.number().int().min(-1),
	domains: z.number().int().min(-1),
	contentItems: z.number().int().min(-1),
	storageGb: z.number().int().min(-1),
	aiIdeasPerMonth: z.number().int().min(-1),
	publishingJobsPerMonth: z.number().int().min(-1),
	apiCallsPerDay: z.number().int().min(-1),
});
export type EnterpriseTierLimits = z.infer<typeof EnterpriseTierLimitsSchema>;

export const EnterpriseBillingTierSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	displayName: z.string(),
	description: z.string().nullable(),
	pricePerSeatCents: z.number().int().min(0),
	interval: EnterpriseBillingIntervalSchema,
	features: EnterpriseTierFeaturesSchema,
	limits: EnterpriseTierLimitsSchema,
	isActive: z.boolean(),
	sortOrder: z.number().int(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type EnterpriseBillingTier = z.infer<typeof EnterpriseBillingTierSchema>;

export const EnterpriseOrgTierSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	tierId: z.string().uuid(),
	seats: z.number().int().min(1),
	overageEnabled: z.boolean(),
	externalSubscriptionId: z.string().nullable(),
	periodEnd: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
	tier: EnterpriseBillingTierSchema.optional(),
});
export type EnterpriseOrgTier = z.infer<typeof EnterpriseOrgTierSchema>;

export const SetOrgTierInputSchema = z.object({
	organizationSlug: z.string().min(1),
	tierId: z.string().uuid(),
	seats: z.number().int().min(1, "At least 1 seat is required"),
	overageEnabled: z.boolean().default(false),
});
export type SetOrgTierInput = z.infer<typeof SetOrgTierInputSchema>;

export const UpdateSeatsInputSchema = z.object({
	organizationSlug: z.string().min(1),
	seats: z.number().int().min(1, "At least 1 seat is required"),
});
export type UpdateSeatsInput = z.infer<typeof UpdateSeatsInputSchema>;

export const GetOrgTierInputSchema = z.object({
	organizationSlug: z.string().min(1),
});

export const OverageAlertSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string().uuid(),
	metric: z.string(),
	thresholdPercent: z.number().int(),
	usageValue: z.number().int(),
	limitValue: z.number().int(),
	sentAt: z.date(),
});
export type OverageAlert = z.infer<typeof OverageAlertSchema>;
