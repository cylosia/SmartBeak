import { relations, sql } from "drizzle-orm";
import {
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

export const users = pgTable("users", {
	id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
	username: text("username").notNull().unique(),
	password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
	username: true,
	password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const THEME_OPTIONS = [
	"affiliate-comparison",
	"authority-site",
	"landing-leadgen",
	"local-business",
	"media-newsletter",
] as const;

export type ThemeOption = (typeof THEME_OPTIONS)[number];

export const DEPLOY_STATUSES = [
	"pending",
	"building",
	"deploying",
	"ready",
	"error",
	"canceled",
] as const;

export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

export const domains = pgTable("domains", {
	id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
	name: text("name").notNull().unique(),
	theme: text("theme").notNull().default("landing-leadgen"),
	description: text("description"),
	status: text("status").notNull().default("active"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const domainsRelations = relations(domains, ({ many }) => ({
	siteShards: many(siteShards),
}));

export const siteShards = pgTable("site_shards", {
	id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
	domainId: varchar("domain_id")
		.notNull()
		.references(() => domains.id, { onDelete: "cascade" }),
	theme: text("theme").notNull(),
	version: integer("version").notNull().default(1),
	deployedUrl: text("deployed_url"),
	vercelProjectId: text("vercel_project_id"),
	vercelDeploymentId: text("vercel_deployment_id"),
	status: text("status").notNull().default("pending"),
	errorMessage: text("error_message"),
	progress: integer("progress").notNull().default(0),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const siteShardsRelations = relations(siteShards, ({ one, many }) => ({
	domain: one(domains, {
		fields: [siteShards.domainId],
		references: [domains.id],
	}),
	versions: many(deploymentVersions),
}));

export const deploymentVersions = pgTable("deployment_versions", {
	id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
	shardId: varchar("shard_id")
		.notNull()
		.references(() => siteShards.id, { onDelete: "cascade" }),
	version: integer("version").notNull(),
	deployedUrl: text("deployed_url"),
	status: text("status").notNull().default("pending"),
	buildLog: text("build_log"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deploymentVersionsRelations = relations(
	deploymentVersions,
	({ one }) => ({
		shard: one(siteShards, {
			fields: [deploymentVersions.shardId],
			references: [siteShards.id],
		}),
	}),
);

export const auditLogs = pgTable("audit_logs", {
	id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
	action: text("action").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	details: jsonb("details"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDomainSchema = createInsertSchema(domains).omit({
	id: true,
	createdAt: true,
});

export const insertSiteShardSchema = createInsertSchema(siteShards).omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

export const insertDeploymentVersionSchema = createInsertSchema(
	deploymentVersions,
).omit({
	id: true,
	createdAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
	id: true,
	createdAt: true,
});

export type Domain = typeof domains.$inferSelect;
export type InsertDomain = z.infer<typeof insertDomainSchema>;
export type SiteShard = typeof siteShards.$inferSelect;
export type InsertSiteShard = z.infer<typeof insertSiteShardSchema>;
export type DeploymentVersion = typeof deploymentVersions.$inferSelect;
export type InsertDeploymentVersion = z.infer<
	typeof insertDeploymentVersionSchema
>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
