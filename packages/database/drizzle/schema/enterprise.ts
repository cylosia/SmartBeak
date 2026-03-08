/**
 * SmartBeak Phase 3A — Enterprise Readiness & Scaling schema extension.
 *
 * These tables are ADDITIVE — the locked v9 smartbeak.ts schema is NOT modified.
 * All tables are prefixed with `enterprise_` for clear namespacing.
 *
 * Covers:
 *  - Team workspaces with granular permissions
 *  - SSO (SAML/OIDC) provider configuration
 *  - SCIM provisioning tokens
 *  - audit log retention policies
 *  - Usage-based billing tiers and seat management
 */

import { relations } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./smartbeak";

// ─── bytea custom type (mirrors smartbeak.ts) ────────────────────────────────
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return "bytea";
	},
});

// ─── Enums ────────────────────────────────────────────────────────────────────

export const enterpriseTeamRoleEnum = pgEnum("enterprise_team_role", [
	"admin",
	"member",
]);

export const enterpriseSsoTypeEnum = pgEnum("enterprise_sso_type", [
	"saml",
	"oidc",
]);

export const enterpriseSsoStatusEnum = pgEnum("enterprise_sso_status", [
	"active",
	"inactive",
	"testing",
]);

export const enterpriseBillingIntervalEnum = pgEnum(
	"enterprise_billing_interval",
	["monthly", "annual"],
);

// ─── 1. Team Workspaces ───────────────────────────────────────────────────────

/**
 * enterprise_teams — Workspace groupings within an organization.
 * Each team can have its own set of members with granular roles,
 * allowing fine-grained access control beyond the org-level RBAC.
 */
export const enterpriseTeams = pgTable(
	"enterprise_teams",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		/** JSON object for team-level feature flags and settings. */
		settings: jsonb("settings").default({}),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enterprise_teams_org_slug_uidx").on(
			table.orgId,
			table.slug,
		),
		index("enterprise_teams_org_id_idx").on(table.orgId),
	],
);

/**
 * enterprise_team_members — Junction table linking users to teams.
 * Supports granular roles (admin, member) at the team level, independent
 * of the user's organization-level role.
 */
export const enterpriseTeamMembers = pgTable(
	"enterprise_team_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		teamId: uuid("team_id")
			.notNull()
			.references(() => enterpriseTeams.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull(),
		role: enterpriseTeamRoleEnum("role").notNull().default("member"),
		/** Tracks which user performed the invitation for audit purposes. */
		invitedBy: text("invited_by"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enterprise_team_members_team_user_uidx").on(
			table.teamId,
			table.userId,
		),
		index("enterprise_team_members_team_id_idx").on(table.teamId),
		index("enterprise_team_members_user_id_idx").on(table.userId),
	],
);

/**
 * enterprise_team_activity — Immutable activity log scoped to a team.
 * Provides a team-level view of recorded actions.
 */
export const enterpriseTeamActivity = pgTable(
	"enterprise_team_activity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		teamId: uuid("team_id")
			.notNull()
			.references(() => enterpriseTeams.id, { onDelete: "cascade" }),
		actorId: text("actor_id").notNull(),
		action: text("action").notNull(),
		entityType: text("entity_type"),
		entityId: text("entity_id"),
		details: jsonb("details"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("enterprise_team_activity_team_id_idx").on(table.teamId),
		index("enterprise_team_activity_actor_id_idx").on(table.actorId),
	],
);

// ─── 2. SSO & SCIM ────────────────────────────────────────────────────────────

/**
 * enterprise_sso_providers — Stores SAML/OIDC configuration per organization.
 * The `encryptedConfig` bytea column stores the full IdP metadata or OIDC
 * client secret, encrypted with AES-256-GCM at the application layer.
 * Only one stored provider configuration per type per org is allowed.
 */
export const enterpriseSsoProviders = pgTable(
	"enterprise_sso_providers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		type: enterpriseSsoTypeEnum("type").notNull(),
		status: enterpriseSsoStatusEnum("status").notNull().default("inactive"),
		/** The email domain this SSO config applies to (e.g., "acme.com"). */
		domain: text("domain").notNull(),
		/** Human-readable label for the provider (e.g., "Okta", "Azure AD"). */
		providerName: text("provider_name"),
		/**
		 * AES-256-GCM encrypted JSON blob containing:
		 * - SAML: { entityId, ssoUrl, certificate, spEntityId, spAcsUrl }
		 * - OIDC: { issuer, clientId, clientSecret, redirectUri, scopes }
		 */
		encryptedConfig: bytea("encrypted_config").notNull(),
		/** Stores non-sensitive metadata for display purposes. */
		metadata: jsonb("metadata").default({}),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("enterprise_sso_providers_org_type_uidx").on(
			table.orgId,
			table.type,
		),
		index("enterprise_sso_providers_org_id_idx").on(table.orgId),
		index("enterprise_sso_providers_domain_idx").on(table.domain),
	],
);

/**
 * enterprise_scim_tokens — Stores hashed SCIM provisioning tokens.
 * The raw token is only returned once at creation time; only a SHA-256
 * hash is stored in the database for security.
 */
export const enterpriseScimTokens = pgTable(
	"enterprise_scim_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** SHA-256 hash of the raw token. Never store the raw token. */
		tokenHash: text("token_hash").notNull().unique(),
		description: text("description"),
		/** Last 4 characters of the raw token for display identification. */
		tokenSuffix: text("token_suffix").notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("enterprise_scim_tokens_org_id_idx").on(table.orgId),
		index("enterprise_scim_tokens_token_hash_idx").on(table.tokenHash),
	],
);

// ─── 3. Audit Log Retention ───────────────────────────────────────────────────

/**
 * enterprise_audit_retention — Per-organization audit log retention policy.
 * Configures how long audit events are kept and whether scheduled exports
 * are enabled. Defaults to 90 days if no policy is set.
 */
export const enterpriseAuditRetention = pgTable(
	"enterprise_audit_retention",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" })
			.unique(),
		/** Number of days to retain audit events. Minimum 30, maximum 2555 (7 years). */
		retentionDays: integer("retention_days").notNull().default(90),
		/** Whether to automatically export audit logs on a schedule. */
		exportEnabled: boolean("export_enabled").notNull().default(false),
		/** Cron expression for scheduled exports (e.g., "0 0 * * 0" for weekly). */
		exportSchedule: text("export_schedule"),
		/** Email address(es) to receive export notifications (comma-separated). */
		exportRecipients: text("export_recipients"),
		updatedBy: text("updated_by"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("enterprise_audit_retention_org_id_idx").on(table.orgId)],
);

// ─── 4. Usage-Based Billing Tiers ─────────────────────────────────────────────

/**
 * enterprise_billing_tiers — Defines available pricing plans.
 * Each tier specifies a price, a set of feature flags, and usage limits.
 * This table is managed by platform administrators.
 */
export const enterpriseBillingTiers = pgTable(
	"enterprise_billing_tiers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull().unique(),
		displayName: text("display_name").notNull(),
		description: text("description"),
		/** Price in cents per seat per billing interval. */
		pricePerSeatCents: integer("price_per_seat_cents").notNull().default(0),
		interval: enterpriseBillingIntervalEnum("interval")
			.notNull()
			.default("monthly"),
		/**
		 * JSON object defining feature availability for this tier.
		 * Example: { sso: true, scim: true, advancedAudit: true, customRoles: false }
		 */
		features: jsonb("features").notNull().default({}),
		/**
		 * JSON object defining usage limits for this tier.
		 * Example: { seats: 50, domains: 100, contentItems: 5000, storageGb: 100 }
		 * A value of -1 indicates unlimited.
		 */
		limits: jsonb("limits").notNull().default({}),
		/** Whether this tier is currently available for selection. */
		isActive: boolean("is_active").notNull().default(true),
		/** Sort order for display purposes. */
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("enterprise_billing_tiers_active_idx").on(table.isActive),
	],
);

/**
 * enterprise_org_tier — Links an organization to its current billing tier.
 * Tracks seat count, overage settings, and the external billing reference.
 */
export const enterpriseOrgTier = pgTable(
	"enterprise_org_tier",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" })
			.unique(),
		tierId: uuid("tier_id")
			.notNull()
			.references(() => enterpriseBillingTiers.id, {
				onDelete: "cascade",
			}),
		/** Configured seat count for this organization. */
		seats: integer("seats").notNull().default(1),
		/** Whether to allow usage beyond the tier limits in org settings. */
		overageEnabled: boolean("overage_enabled").notNull().default(false),
		/** Optional external subscription identifier for billing integrations. */
		externalSubscriptionId: text("external_subscription_id"),
		/** Timestamp when the current tier period ends. */
		periodEnd: timestamp("period_end", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("enterprise_org_tier_org_id_idx").on(table.orgId),
		index("enterprise_org_tier_tier_id_idx").on(table.tierId),
	],
);

/**
 * enterprise_overage_alerts — Tracks overage notifications sent to orgs.
 * Ensures alerts are not sent repeatedly for the same threshold breach.
 */
export const enterpriseOverageAlerts = pgTable(
	"enterprise_overage_alerts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orgId: uuid("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		metric: text("metric").notNull(),
		/** The percentage threshold that triggered this alert (e.g., 80, 90, 100). */
		thresholdPercent: integer("threshold_percent").notNull(),
		/** The actual usage value at the time of the alert. */
		usageValue: integer("usage_value").notNull(),
		/** The limit value at the time of the alert. */
		limitValue: integer("limit_value").notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("enterprise_overage_alerts_org_id_idx").on(table.orgId),
		index("enterprise_overage_alerts_metric_idx").on(table.metric),
	],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const enterpriseTeamsRelations = relations(
	enterpriseTeams,
	({ many }) => ({
		members: many(enterpriseTeamMembers),
		activity: many(enterpriseTeamActivity),
	}),
);

export const enterpriseTeamMembersRelations = relations(
	enterpriseTeamMembers,
	({ one }) => ({
		team: one(enterpriseTeams, {
			fields: [enterpriseTeamMembers.teamId],
			references: [enterpriseTeams.id],
		}),
	}),
);

export const enterpriseTeamActivityRelations = relations(
	enterpriseTeamActivity,
	({ one }) => ({
		team: one(enterpriseTeams, {
			fields: [enterpriseTeamActivity.teamId],
			references: [enterpriseTeams.id],
		}),
	}),
);

export const enterpriseSsoProvidersRelations = relations(
	enterpriseSsoProviders,
	({ one }) => ({
		organization: one(organizations, {
			fields: [enterpriseSsoProviders.orgId],
			references: [organizations.id],
		}),
	}),
);

export const enterpriseScimTokensRelations = relations(
	enterpriseScimTokens,
	({ one }) => ({
		organization: one(organizations, {
			fields: [enterpriseScimTokens.orgId],
			references: [organizations.id],
		}),
	}),
);

export const enterpriseBillingTiersRelations = relations(
	enterpriseBillingTiers,
	({ many }) => ({
		orgTiers: many(enterpriseOrgTier),
	}),
);

export const enterpriseOrgTierRelations = relations(
	enterpriseOrgTier,
	({ one }) => ({
		organization: one(organizations, {
			fields: [enterpriseOrgTier.orgId],
			references: [organizations.id],
		}),
		tier: one(enterpriseBillingTiers, {
			fields: [enterpriseOrgTier.tierId],
			references: [enterpriseBillingTiers.id],
		}),
	}),
);
