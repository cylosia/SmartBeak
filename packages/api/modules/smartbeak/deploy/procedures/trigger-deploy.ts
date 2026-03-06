import { ORPCError } from "@orpc/server";
import {
  createSiteShard,
  getDomainById,
  getSiteShardsForDomain,
  updateDomain,
  updateSiteShard,
} from "@repo/database";
import { logger } from "@repo/logs";
import { fetchWithTimeout } from "@repo/utils";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";
import { audit } from "../../lib/audit";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
import { generateThemeHtml, THEME_IDS } from "../lib/themes";

const VERCEL_API = "https://api.vercel.com";

function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52);
}

export const triggerDeploy = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/deploy/trigger",
    tags: ["SmartBeak - Deploy"],
    summary: "Trigger a Vercel deployment for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      themeId: z.enum(THEME_IDS).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", {
        message: "Domain not found.",
      });
    }

    const token = process.env.VERCEL_TOKEN;
    if (!token) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "VERCEL_TOKEN is not configured. Deployment is unavailable.",
      });
    }

    if (domain.status === "pending" || domain.status === "building") {
      throw new ORPCError("CONFLICT", {
        message: "A deployment is already in progress for this domain.",
      });
    }

    const themeId = input.themeId ?? domain.themeId ?? "landing-leadgen";
    const existingShards = await getSiteShardsForDomain(domain.id);
    const nextVersion = existingShards.length > 0
      ? Math.max(...existingShards.map((s) => s.version)) + 1
      : 1;

    const [shard] = await createSiteShard({
      domainId: domain.id,
      version: nextVersion,
      status: "building",
    });

    if (!shard) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create deployment shard.",
      });
    }

    await updateDomain(domain.id, { status: "pending" });

    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "deploy_started",
      entityType: "site_shard",
      entityId: shard.id,
      details: { domainId: domain.id, themeId, version: nextVersion },
    });

    logger.info(`[trigger-deploy] deploy v${nextVersion} started for domain=${domain.id}`);

    (async () => {
      try {
        const html = generateThemeHtml(themeId, domain.name);
        const projectName = sanitizeProjectName(
          `smartbeak-${domain.slug || domain.name}-${Date.now()}`,
        );

        const files = [
          {
            file: "index.html",
            data: Buffer.from(html).toString("base64"),
            encoding: "base64" as const,
          },
          {
            file: "vercel.json",
            data: Buffer.from(
              JSON.stringify({ cleanUrls: true, trailingSlash: false }),
            ).toString("base64"),
            encoding: "base64" as const,
          },
        ];

        await updateSiteShard(shard.id, { status: "deploying" });

        const deployRes = await fetchWithTimeout(`${VERCEL_API}/v13/deployments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: projectName,
            files,
            projectSettings: { framework: null },
            target: "production",
          }),
          timeoutMs: 30_000,
        });

        if (!deployRes.ok) {
          const errText = await deployRes.text();
          logger.error(`[trigger-deploy] Vercel API ${deployRes.status}`, { errText });
          throw new ORPCError("BAD_GATEWAY", {
            message: "Deployment failed. Vercel API returned an error.",
          });
        }

        const deployData = (await deployRes.json()) as {
          id: string;
          url?: string;
          readyState: string;
        };

        if (!deployData.url) {
          throw new ORPCError("BAD_GATEWAY", {
            message: "Vercel response missing deployment URL",
          });
        }

        const deployedUrl = `https://${deployData.url}`;
        await updateSiteShard(shard.id, {
          deployedUrl,
          status: "deploying",
        });

        let ready = false;
        let attempts = 0;
        let consecutive4xx = 0;
        const maxAttempts = 60;

        while (!ready && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          attempts++;

          const statusRes = await fetchWithTimeout(
            `${VERCEL_API}/v13/deployments/${deployData.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              timeoutMs: 10_000,
            },
          );
          if (!statusRes.ok) {
            if (statusRes.status >= 400 && statusRes.status < 500) {
              consecutive4xx++;
              if (consecutive4xx >= 3) {
                throw new ORPCError("BAD_GATEWAY", {
                  message: "Deployment status check failed after multiple retries.",
                });
              }
            }
            continue;
          }
          consecutive4xx = 0;

          const statusData = (await statusRes.json()) as {
            readyState: string;
          };

          if (statusData.readyState === "READY") {
            ready = true;
          } else if (
            statusData.readyState === "ERROR" ||
            statusData.readyState === "CANCELED"
          ) {
            throw new ORPCError("BAD_GATEWAY", {
              message: `Deployment ${statusData.readyState.toLowerCase()}`,
            });
          }
        }

        if (!ready) {
          throw new ORPCError("REQUEST_TIMEOUT", {
            message: "Deployment timed out after 2 minutes",
          });
        }

        await updateSiteShard(shard.id, {
          deployedUrl,
          status: "deployed",
        });

        await updateDomain(domain.id, { deployedUrl, status: "deployed" });

        await audit({
          orgId: org.id,
          actorId: user.id,
          action: "deploy_success",
          entityType: "site_shard",
          entityId: shard.id,
          details: { url: deployedUrl, version: nextVersion },
        });
      } catch (err: unknown) {
        logger.error("[trigger-deploy] deployment error:", err);
        const message =
          err instanceof Error ? err.message : "Unknown deployment error";
        await updateSiteShard(shard.id, { status: "error" });
        await audit({
          orgId: org.id,
          actorId: user.id,
          action: "deploy_error",
          entityType: "site_shard",
          entityId: shard.id,
          details: { error: message },
        });
      }
    })().catch((fatal) => {
      logger.error("[trigger-deploy] unhandled deploy failure:", fatal);
    });

    return { shard };
  });
