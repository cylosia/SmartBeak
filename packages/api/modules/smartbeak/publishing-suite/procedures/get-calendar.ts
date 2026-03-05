import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getScheduledJobsInRange,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getCalendarProcedure = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing-suite/calendar",
    tags: ["SmartBeak - Publishing Suite"],
    summary: "Get scheduled publishing jobs in a date range for the calendar view",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      from: z.string().datetime(),
      to: z.string().datetime(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    const jobs = await getScheduledJobsInRange(
      input.domainId,
      new Date(input.from),
      new Date(input.to),
    );

    // Shape for calendar: group by date
    const byDate: Record<string, typeof jobs> = {};
    for (const job of jobs) {
      if (!job.scheduledFor) continue;
      const dateKey = job.scheduledFor.toISOString().slice(0, 10);
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(job);
    }

    return { jobs, byDate };
  });
