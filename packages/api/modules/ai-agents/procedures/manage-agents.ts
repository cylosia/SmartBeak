/**
 * Phase 3B — AI Agents Management Procedures
 *
 * orpc procedures for CRUD operations on ai_agents.
 * All procedures are protected and scoped to the caller's organization.
 */

import { ORPCError } from "@orpc/server";
import {
  createAgent,
  deleteAgent,
  getActiveAgentsForOrg,
  getAgentById,
  getAgentsForOrg,
  updateAgent,
} from "@repo/database";
import {
  AiAgentConfigSchema,
  CreateAiAgentInputSchema,
  UpdateAiAgentInputSchema,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../orpc/procedures";
import { requireOrgMembership } from "../../smartbeak/lib/membership";
import { resolveSmartBeakOrg } from "../../smartbeak/lib/resolve-org";

// ─── List Agents ──────────────────────────────────────────────────────────────

export const listAgents = protectedProcedure
  .route({
    method: "GET",
    path: "/ai-agents/agents",
    tags: ["AI Agents"],
    summary: "List all agents for an organization",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);
    const agents = await getAgentsForOrg(org.id);
    return { agents };
  });

// ─── Create Agent ─────────────────────────────────────────────────────────────

export const createAgentProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/ai-agents/agents",
    tags: ["AI Agents"],
    summary: "Create a new AI agent",
  })
  .input(CreateAiAgentInputSchema)
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const defaultConfig = AiAgentConfigSchema.parse({});
    const config = input.config
      ? AiAgentConfigSchema.parse({ ...defaultConfig, ...input.config })
      : defaultConfig;

    // Set type-appropriate defaults
    if (input.agentType === "research") {
      config.tools = ["web_search", "read_url", "fact_check"];
      config.temperature = 0.3;
    } else if (input.agentType === "writer") {
      config.temperature = 0.8;
      config.maxTokens = 8192;
    } else if (input.agentType === "editor") {
      config.temperature = 0.4;
    }

    const agent = await createAgent({
      orgId: org.id,
      name: input.name,
      description: input.description,
      agentType: input.agentType ?? "custom",
      config,
      createdBy: user.id,
    });

    return { agent };
  });

// ─── Update Agent ─────────────────────────────────────────────────────────────

export const updateAgentProcedure = protectedProcedure
  .route({
    method: "PATCH",
    path: "/ai-agents/agents/{agentId}",
    tags: ["AI Agents"],
    summary: "Update an AI agent's configuration",
  })
  .input(UpdateAiAgentInputSchema)
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const existing = await getAgentById(input.agentId);
    if (!existing || existing.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
    }

    const updated = await updateAgent(input.agentId, {
      name: input.name,
      description: input.description,
      config: input.config
        ? { ...(existing.config as object), ...input.config }
        : undefined,
      isActive: input.isActive,
    });

    return { agent: updated };
  });

// ─── Delete Agent ─────────────────────────────────────────────────────────────

export const deleteAgentProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/ai-agents/agents/{agentId}",
    tags: ["AI Agents"],
    summary: "Delete an AI agent",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      agentId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const existing = await getAgentById(input.agentId);
    if (!existing || existing.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
    }

    await deleteAgent(input.agentId);
    return { success: true };
  });

// ─── Seed Default Agents ──────────────────────────────────────────────────────

export const seedDefaultAgents = protectedProcedure
  .route({
    method: "POST",
    path: "/ai-agents/agents/seed",
    tags: ["AI Agents"],
    summary: "Seed the three default agents (Research, Writer, Editor) for an org",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const existing = await getActiveAgentsForOrg(org.id);
    if (existing.length > 0) {
      return { agents: existing, seeded: false };
    }

    const defaults = [
      {
        name: "Research Agent",
        agentType: "research" as const,
        description: "Searches the web, reads sources, and produces structured research briefs.",
        config: AiAgentConfigSchema.parse({
          model: "gpt-4o-mini",
          temperature: 0.3,
          maxTokens: 4096,
          tools: ["web_search", "read_url", "fact_check"],
          systemPrompt: `You are an expert Research Agent for a content marketing platform.
Your role is to:
1. Search for and synthesize information from multiple credible sources.
2. Extract key facts, statistics, quotes, and insights.
3. Identify the most authoritative sources on the topic.
4. Produce a structured research brief with clear sections and citations.
Always prioritize accuracy over speed. Note any conflicting information.`,
        }),
      },
      {
        name: "Writer Agent",
        agentType: "writer" as const,
        description: "Transforms research and outlines into compelling, SEO-optimized content.",
        config: AiAgentConfigSchema.parse({
          model: "gpt-4o-mini",
          temperature: 0.8,
          maxTokens: 8192,
          tools: [],
          systemPrompt: `You are an expert Writer Agent for a content marketing platform.
Your role is to:
1. Transform research briefs and outlines into compelling, well-structured articles.
2. Write in a clear, engaging, and authoritative voice appropriate for the target audience.
3. Use short paragraphs, active voice, and strong headlines for readability.
4. Naturally incorporate target keywords without keyword stuffing.
5. Ensure the content is original, valuable, and publication-ready.
Produce complete, polished drafts that require minimal editing.`,
        }),
      },
      {
        name: "Editor Agent",
        agentType: "editor" as const,
        description: "Reviews and improves content for clarity, accuracy, and SEO.",
        config: AiAgentConfigSchema.parse({
          model: "gpt-4o-mini",
          temperature: 0.4,
          maxTokens: 8192,
          tools: ["fact_check"],
          systemPrompt: `You are an expert Editor Agent for a content marketing platform.
Your role is to:
1. Review content for clarity, accuracy, logical flow, and consistency.
2. Improve sentence structure, word choice, and transitions.
3. Check for factual accuracy and flag any unsupported claims.
4. Optimize for the target audience and SEO without changing the core message.
5. Ensure the content meets publication standards.
Return the improved version followed by a brief "Editor's Notes" section summarizing key changes.`,
        }),
      },
    ];

    const agents = await Promise.all(
      defaults.map((d) =>
        createAgent({
          orgId: org.id,
          name: d.name,
          description: d.description,
          agentType: d.agentType,
          config: d.config,
          createdBy: user.id,
        }),
      ),
    );

    return { agents, seeded: true };
  });
