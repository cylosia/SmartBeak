import {
	type AuditLog,
	auditLogs,
	type DeploymentVersion,
	type Domain,
	deploymentVersions,
	domains,
	type InsertAuditLog,
	type InsertDeploymentVersion,
	type InsertDomain,
	type InsertSiteShard,
	type InsertUser,
	type SiteShard,
	siteShards,
	type User,
	users,
} from "@shared/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";

export interface IStorage {
	getUser(id: string): Promise<User | undefined>;
	getUserByUsername(username: string): Promise<User | undefined>;
	createUser(user: InsertUser): Promise<User>;

	getDomains(): Promise<Domain[]>;
	getDomain(id: string): Promise<Domain | undefined>;
	createDomain(domain: InsertDomain): Promise<Domain>;
	updateDomain(id: string, data: Partial<InsertDomain>): Promise<Domain>;
	deleteDomain(id: string): Promise<void>;

	getSiteShards(domainId: string): Promise<SiteShard[]>;
	getSiteShard(id: string): Promise<SiteShard | undefined>;
	getLatestSiteShard(domainId: string): Promise<SiteShard | undefined>;
	getLatestSiteShardsByDomainIds(
		domainIds: string[],
	): Promise<Map<string, SiteShard>>;
	createSiteShard(shard: InsertSiteShard): Promise<SiteShard>;
	updateSiteShard(
		id: string,
		data: Partial<InsertSiteShard>,
	): Promise<SiteShard>;

	getDeploymentVersions(shardId: string): Promise<DeploymentVersion[]>;
	createDeploymentVersion(
		version: InsertDeploymentVersion,
	): Promise<DeploymentVersion>;
	updateDeploymentVersion(
		id: string,
		data: Partial<InsertDeploymentVersion>,
	): Promise<DeploymentVersion>;

	getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]>;
	getAuditLogsForDomain(domainId: string): Promise<AuditLog[]>;
	createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
}

export class DatabaseStorage implements IStorage {
	async getUser(id: string): Promise<User | undefined> {
		const [user] = await db.select().from(users).where(eq(users.id, id));
		return user || undefined;
	}

	async getUserByUsername(username: string): Promise<User | undefined> {
		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.username, username));
		return user || undefined;
	}

	async createUser(insertUser: InsertUser): Promise<User> {
		const [user] = await db.insert(users).values(insertUser).returning();
		return user;
	}

	async getDomains(): Promise<Domain[]> {
		return db
			.select()
			.from(domains)
			.orderBy(desc(domains.createdAt))
			.limit(500);
	}

	async getDomain(id: string): Promise<Domain | undefined> {
		const [domain] = await db
			.select()
			.from(domains)
			.where(eq(domains.id, id));
		return domain || undefined;
	}

	async createDomain(domain: InsertDomain): Promise<Domain> {
		const [created] = await db.insert(domains).values(domain).returning();
		return created;
	}

	async updateDomain(
		id: string,
		data: Partial<InsertDomain>,
	): Promise<Domain> {
		const [updated] = await db
			.update(domains)
			.set(data)
			.where(eq(domains.id, id))
			.returning();
		return updated;
	}

	async deleteDomain(id: string): Promise<void> {
		await db.delete(domains).where(eq(domains.id, id));
	}

	async getSiteShards(domainId: string): Promise<SiteShard[]> {
		return db
			.select()
			.from(siteShards)
			.where(eq(siteShards.domainId, domainId))
			.orderBy(desc(siteShards.version), desc(siteShards.createdAt))
			.limit(100);
	}

	async getSiteShard(id: string): Promise<SiteShard | undefined> {
		const [shard] = await db
			.select()
			.from(siteShards)
			.where(eq(siteShards.id, id));
		return shard || undefined;
	}

	async getLatestSiteShard(domainId: string): Promise<SiteShard | undefined> {
		const [shard] = await db
			.select()
			.from(siteShards)
			.where(eq(siteShards.domainId, domainId))
			.orderBy(desc(siteShards.version))
			.limit(1);
		return shard || undefined;
	}

	async getLatestSiteShardsByDomainIds(
		domainIds: string[],
	): Promise<Map<string, SiteShard>> {
		if (domainIds.length === 0) {
			return new Map();
		}
		const rows = await db
			.select()
			.from(siteShards)
			.where(inArray(siteShards.domainId, domainIds))
			.orderBy(
				siteShards.domainId,
				desc(siteShards.version),
				desc(siteShards.createdAt),
			);
		const map = new Map<string, SiteShard>();
		for (const row of rows) {
			if (!map.has(row.domainId)) {
				map.set(row.domainId, row);
			}
		}
		return map;
	}

	async createSiteShard(shard: InsertSiteShard): Promise<SiteShard> {
		const [created] = await db.insert(siteShards).values(shard).returning();
		return created;
	}

	async updateSiteShard(
		id: string,
		data: Partial<InsertSiteShard>,
	): Promise<SiteShard> {
		const [updated] = await db
			.update(siteShards)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(siteShards.id, id))
			.returning();
		return updated;
	}

	async getDeploymentVersions(shardId: string): Promise<DeploymentVersion[]> {
		return db
			.select()
			.from(deploymentVersions)
			.where(eq(deploymentVersions.shardId, shardId))
			.orderBy(desc(deploymentVersions.version))
			.limit(50);
	}

	async createDeploymentVersion(
		version: InsertDeploymentVersion,
	): Promise<DeploymentVersion> {
		const [created] = await db
			.insert(deploymentVersions)
			.values(version)
			.returning();
		return created;
	}

	async updateDeploymentVersion(
		id: string,
		data: Partial<InsertDeploymentVersion>,
	): Promise<DeploymentVersion> {
		const [updated] = await db
			.update(deploymentVersions)
			.set(data)
			.where(eq(deploymentVersions.id, id))
			.returning();
		return updated;
	}

	async getAuditLogs(
		entityType?: string,
		entityId?: string,
	): Promise<AuditLog[]> {
		if (entityType && entityId) {
			return db
				.select()
				.from(auditLogs)
				.where(
					and(
						eq(auditLogs.entityType, entityType),
						eq(auditLogs.entityId, entityId),
					),
				)
				.orderBy(desc(auditLogs.createdAt))
				.limit(100);
		}
		return db
			.select()
			.from(auditLogs)
			.orderBy(desc(auditLogs.createdAt))
			.limit(100);
	}

	async getAuditLogsForDomain(domainId: string): Promise<AuditLog[]> {
		const shardRows = await db
			.select({ id: siteShards.id })
			.from(siteShards)
			.where(eq(siteShards.domainId, domainId));
		const shardIds = shardRows.map((row) => row.id);

		const filters = [
			and(eq(auditLogs.entityType, "domain"), eq(auditLogs.entityId, domainId)),
		];

		if (shardIds.length > 0) {
			filters.push(
				and(
					eq(auditLogs.entityType, "site_shard"),
					inArray(auditLogs.entityId, shardIds),
				),
			);
		}

		return db
			.select()
			.from(auditLogs)
			.where(or(...filters))
			.orderBy(desc(auditLogs.createdAt))
			.limit(100);
	}

	async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
		const [created] = await db.insert(auditLogs).values(log).returning();
		return created;
	}
}

export const storage = new DatabaseStorage();
