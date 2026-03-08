import {
	getOnboardingProgressForOrg,
	upsertOnboardingStep,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgEditor, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getOnboardingProgress = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/onboarding",
		tags: ["SmartBeak - Onboarding"],
		summary: "Get onboarding progress for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
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
			organizationSlug: z.string().min(1).max(255),
			step: z.string().min(1).max(100),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const [record] = await upsertOnboardingStep({
			orgId: org.id,
			step: input.step,
			completed: true,
		});
		return { record };
	});
