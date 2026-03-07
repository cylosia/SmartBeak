import { createHash, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import {
	insertDomainSchema,
	THEME_OPTIONS,
	type ThemeOption,
} from "@shared/schema";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { deployToVercel } from "./deploy";
import { storage } from "./storage";
import { generateThemeHtml, getThemeConfigs } from "./themes";

function log(message: string, source = "routes") {
	const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
	console.log(`${timestamp} [${source}] ${message}`);
}

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
	const apiKey = req.headers["x-api-key"];
	const expected = process.env.SERVER_API_KEY;
	if (!expected) {
		res.status(503).json({ message: "Server API key not configured" });
		return;
	}
	if (typeof apiKey !== "string") {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}
	const hash = (v: string) => createHash("sha256").update(v).digest();
	const isValid = timingSafeEqual(hash(apiKey), hash(expected));
	if (!isValid) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}
	next();
}

export async function registerRoutes(
	httpServer: Server,
	app: Express,
): Promise<Server> {
	app.use("/api", requireApiKey);

	app.get("/api/domains", async (_req, res) => {
		try {
			const domainList = await storage.getDomains();
			const shardMap = await storage.getLatestSiteShardsByDomainIds(
				domainList.map((d) => d.id),
			);
			const domainsWithShards = domainList.map((domain) => ({
				...domain,
				latestShard: shardMap.get(domain.id) ?? null,
			}));
			res.json(domainsWithShards);
		} catch (err) {
			log(
				`GET /api/domains failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to fetch domains." });
		}
	});

	app.get("/api/domains/:id", async (req, res) => {
		try {
			const domain = await storage.getDomain(req.params.id);
			if (!domain) {
				return res.status(404).json({ message: "Domain not found" });
			}
			const shards = await storage.getSiteShards(domain.id);
			const latestShard = shards[0] || null;
			res.json({ ...domain, shards, latestShard });
		} catch (err) {
			log(
				`GET /api/domains/:id failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to fetch domain." });
		}
	});

	app.post("/api/domains", async (req, res) => {
		try {
			const parsed = insertDomainSchema.parse(req.body);
			const domain = await storage.createDomain(parsed);
			await storage.createAuditLog({
				action: "domain_created",
				entityType: "domain",
				entityId: domain.id,
				details: { name: domain.name, theme: domain.theme },
			});
			res.status(201).json(domain);
		} catch (err) {
			log(
				`POST /api/domains failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(400).json({ message: "Invalid domain data." });
		}
	});

	app.patch("/api/domains/:id", async (req, res) => {
		try {
			const domain = await storage.getDomain(req.params.id);
			if (!domain) {
				return res.status(404).json({ message: "Domain not found" });
			}
			const updateSchema = insertDomainSchema.partial();
			const parsed = updateSchema.parse(req.body);
			const updated = await storage.updateDomain(req.params.id, parsed);
			res.json(updated);
		} catch (err) {
			log(
				`PATCH /api/domains/:id failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(400).json({ message: "Invalid update data." });
		}
	});

	app.delete("/api/domains/:id", async (req, res) => {
		try {
			await storage.deleteDomain(req.params.id);
			await storage.createAuditLog({
				action: "domain_deleted",
				entityType: "domain",
				entityId: req.params.id,
				details: {},
			});
			res.json({ ok: true });
		} catch (err) {
			log(
				`DELETE /api/domains/:id failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to delete domain." });
		}
	});

	app.post("/api/domains/:id/deploy", async (req, res) => {
		try {
			const domain = await storage.getDomain(req.params.id);
			if (!domain) {
				return res.status(404).json({ message: "Domain not found" });
			}

			const themeSchema = z.object({
				theme: z.enum(THEME_OPTIONS).optional(),
			});
			const { theme } = themeSchema.parse(req.body);

			const domainTheme = THEME_OPTIONS.includes(
				domain.theme as ThemeOption,
			)
				? (domain.theme as ThemeOption)
				: THEME_OPTIONS[0];
			const selectedTheme = theme ?? domainTheme;

			const shard = await deployToVercel(
				domain.id,
				selectedTheme,
				domain.name,
			);
			res.status(201).json(shard);
		} catch (err) {
			log(
				`POST /api/domains/:id/deploy failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Deployment failed." });
		}
	});

	app.get("/api/shards/:id", async (req, res) => {
		try {
			const shard = await storage.getSiteShard(req.params.id);
			if (!shard) {
				return res.status(404).json({ message: "Shard not found" });
			}
			res.json(shard);
		} catch (err) {
			log(
				`GET /api/shards/:id failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to fetch shard." });
		}
	});

	app.get("/api/shards/:id/versions", async (req, res) => {
		try {
			const versions = await storage.getDeploymentVersions(req.params.id);
			res.json(versions);
		} catch (err) {
			log(
				`GET /api/shards/:id/versions failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to fetch versions." });
		}
	});

	app.get("/api/themes", async (_req, res) => {
		res.json(getThemeConfigs());
	});

	app.get("/api/themes/:theme/preview", async (req, res) => {
		try {
			const theme = req.params.theme as ThemeOption;
			if (!THEME_OPTIONS.includes(theme)) {
				return res.status(400).json({ message: "Invalid theme" });
			}
			const domainName = (req.query.domain as string) || "example.com";
			const html = generateThemeHtml(theme, domainName);
			res.setHeader("Content-Type", "text/html");
			res.send(html);
		} catch (err) {
			log(
				`GET /api/themes/:theme/preview failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to generate preview." });
		}
	});

	app.get("/api/audit-logs", async (req, res) => {
		try {
			const logs = await storage.getAuditLogs(
				req.query.entityType as string,
				req.query.entityId as string,
			);
			res.json(logs);
		} catch (err) {
			log(
				`GET /api/audit-logs failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			res.status(500).json({ message: "Failed to fetch audit logs." });
		}
	});

	return httpServer;
}
