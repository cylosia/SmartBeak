import { ORPCError } from "@orpc/server";
import {
  getOnboardingProgressForOrg,
  getOrganizationBySlug,
  upsertOnboardingStep,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getOnboardingProgress = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/onboarding",
    tags: ["SmartBeak - Onboarding"],
    summary: "Get onboarding progress for an organization",
  })
  .input(z.object({ organizationSlug: z.string() }))
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const progress = await getOnboardingProgressForOrg(org.id);
    return { progress };
  });

export const completeOnboardingStep = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/onboarding/complete",
    tags: ["SmartBeak - Onboarding"],
    summary: "Mark an onboarding step as completed",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      step: z.string().min(1).max(100),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const [record] = await upsertOnboardingStep({
      orgId: org.id,
      step: input.step,
      completed: true,
    });
    return { record };
  });
