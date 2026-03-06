import type { SiteShard, ThemeOption } from "@shared/schema";
import { log } from "./index";
import { storage } from "./storage";
import { generateThemeHtml } from "./themes";

const VERCEL_API = "https://api.vercel.com";

function getVercelToken(): string {
	const token = process.env.VERCEL_TOKEN;
	if (!token) {
		throw new Error("VERCEL_TOKEN is not configured");
	}
	return token;
}

async function vercelFetch(
	path: string,
	options: RequestInit = {},
): Promise<Response> {
	const token = getVercelToken();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 60_000);
	try {
		return await fetch(`${VERCEL_API}${path}`, {
			...options,
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});
	} finally {
		clearTimeout(timeout);
	}
}

function sanitizeProjectName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 52);
}

export async function deployToVercel(
	domainId: string,
	theme: ThemeOption,
	domainName: string,
): Promise<SiteShard> {
	const latestShard = await storage.getLatestSiteShard(domainId);
	const nextVersion = latestShard ? latestShard.version + 1 : 1;

	const shard = await storage.createSiteShard({
		domainId,
		theme,
		version: nextVersion,
		status: "pending",
		progress: 0,
	});

	const deployVersion = await storage.createDeploymentVersion({
		shardId: shard.id,
		version: nextVersion,
		status: "pending",
	});

	await storage.createAuditLog({
		action: "deploy_started",
		entityType: "site_shard",
		entityId: shard.id,
		details: { domainId, theme, version: nextVersion, domainName },
	});

	(async () => {
		try {
			await storage.updateSiteShard(shard.id, {
				status: "building",
				progress: 10,
			});

			const html = generateThemeHtml(theme, domainName);
			await storage.updateSiteShard(shard.id, { progress: 30 });

			log(
				`Generated HTML for ${domainName} with theme ${theme}`,
				"deploy",
			);

			const projectName = sanitizeProjectName(
				`smartbeak-${domainName}-${Date.now()}`,
			);

			const files = [
				{
					file: "index.html",
					data: html,
				},
				{
					file: "vercel.json",
					data: JSON.stringify({
						cleanUrls: true,
						trailingSlash: false,
					}),
				},
			];

			const filesWithEncoding = files.map((f) => ({
				file: f.file,
				data: Buffer.from(f.data).toString("base64"),
				encoding: "base64" as const,
			}));

			await storage.updateSiteShard(shard.id, {
				status: "deploying",
				progress: 50,
			});

			const deployRes = await vercelFetch("/v13/deployments", {
				method: "POST",
				body: JSON.stringify({
					name: projectName,
					files: filesWithEncoding,
					projectSettings: {
						framework: null,
					},
					target: "production",
				}),
			});

			if (!deployRes.ok) {
				const errText = await deployRes.text();
				throw new Error(
					`Vercel API error: ${deployRes.status} - ${errText}`,
				);
			}

			const deployData = (await deployRes.json()) as {
				id: string;
				url: string;
				readyState: string;
				projectId?: string;
			};

			log(
				`Vercel deployment created: ${deployData.id} - ${deployData.url}`,
				"deploy",
			);

			await storage.updateSiteShard(shard.id, {
				vercelDeploymentId: deployData.id,
				vercelProjectId: deployData.projectId || "",
				deployedUrl: `https://${deployData.url}`,
				progress: 70,
			});

			let ready = false;
			let attempts = 0;
			const maxAttempts = 60;

			while (!ready && attempts < maxAttempts) {
				await new Promise((r) => setTimeout(r, 2000));
				attempts++;

				const statusRes = await vercelFetch(
					`/v13/deployments/${deployData.id}`,
				);
				if (!statusRes.ok) {
					continue;
				}
				const statusData = (await statusRes.json()) as {
					readyState: string;
				};
				const currentProgress = Math.min(
					70 + Math.floor((attempts / maxAttempts) * 25),
					95,
				);
				await storage.updateSiteShard(shard.id, {
					progress: currentProgress,
				});

				if (statusData.readyState === "READY") {
					ready = true;
				} else if (
					statusData.readyState === "ERROR" ||
					statusData.readyState === "CANCELED"
				) {
					throw new Error(
						`Deployment ${statusData.readyState.toLowerCase()}`,
					);
				}
			}

			if (!ready) {
				throw new Error("Deployment timed out after 2 minutes");
			}

			await storage.updateSiteShard(shard.id, {
				status: "ready",
				progress: 100,
				deployedUrl: `https://${deployData.url}`,
			});

			await storage.updateDeploymentVersion(deployVersion.id, {
				status: "ready",
				deployedUrl: `https://${deployData.url}`,
				buildLog: `Deployed successfully at ${new Date().toISOString()}`,
			});

			await storage.createAuditLog({
				action: "deploy_success",
				entityType: "site_shard",
				entityId: shard.id,
				details: {
					domainId,
					theme,
					version: nextVersion,
					url: `https://${deployData.url}`,
				},
			});

			log(`Deployment ready: https://${deployData.url}`, "deploy");
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			log(`Deployment error: ${errMsg}`, "deploy");

			await storage.updateSiteShard(shard.id, {
				status: "error",
				errorMessage: errMsg,
				progress: 0,
			});

			await storage.updateDeploymentVersion(deployVersion.id, {
				status: "error",
				buildLog: `Error: ${errMsg}`,
			});

			await storage.createAuditLog({
				action: "deploy_error",
				entityType: "site_shard",
				entityId: shard.id,
				details: { error: errMsg },
			});
		}
	})();

	return shard;
}
