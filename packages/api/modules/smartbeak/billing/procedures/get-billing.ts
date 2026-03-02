import { ORPCError } from "@orpc/server";
import {
  getInvoicesForOrg,
  getOrganizationBySlug,
  getSubscriptionForOrg,
  getUsageRecordsForOrg,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getBilling = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/billing",
    tags: ["SmartBeak - Billing"],
    summary: "Get billing overview: subscription, invoices, and usage",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const [subscription, invoices, usageRecords] = await Promise.all([
      getSubscriptionForOrg(org.id),
      getInvoicesForOrg(org.id, { limit: 10 }),
      getUsageRecordsForOrg(org.id, { limit: 50 }),
    ]);
    return { subscription, invoices, usageRecords };
  });
