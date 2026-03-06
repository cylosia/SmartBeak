import { ORPCError } from "@orpc/server";
import { resolveSmartBeakOrg } from "../../modules/smartbeak/lib/resolve-org";
import {
  requireOrgMembership,
  requireOrgAdmin,
  requireOrgEditor,
} from "../../modules/smartbeak/lib/membership";

type OrgRole = "member" | "editor" | "admin";

interface OrgContext {
  org: Awaited<ReturnType<typeof resolveSmartBeakOrg>>;
  membership: Awaited<ReturnType<typeof requireOrgMembership>>;
}

/**
 * oRPC middleware that resolves the SmartBeak organization from
 * `input.organizationSlug` and verifies the user's role, injecting
 * `org` and `membership` into the handler context.
 *
 * Usage:
 *   protectedProcedure
 *     .input(z.object({ organizationSlug: z.string().min(1), ... }))
 *     .use(withOrgContext("editor"))
 *     .handler(async ({ context: { org, membership }, input }) => { ... })
 */
export function withOrgContext(minimumRole: OrgRole = "member") {
  return async ({
    context,
    input,
    next,
  }: {
    context: { user: { id: string } };
    input: { organizationSlug: string };
    next: (opts: { context: OrgContext }) => Promise<unknown>;
  }) => {
    if (!input.organizationSlug) {
      throw new ORPCError("BAD_REQUEST", {
        message: "organizationSlug is required.",
      });
    }

    const org = await resolveSmartBeakOrg(input.organizationSlug);

    let membership: Awaited<ReturnType<typeof requireOrgMembership>>;
    switch (minimumRole) {
      case "admin":
        membership = await requireOrgAdmin(org.supastarterOrgId, context.user.id);
        break;
      case "editor":
        membership = await requireOrgEditor(org.supastarterOrgId, context.user.id);
        break;
      default:
        membership = await requireOrgMembership(org.supastarterOrgId, context.user.id);
        break;
    }

    return next({ context: { org, membership } });
  };
}
