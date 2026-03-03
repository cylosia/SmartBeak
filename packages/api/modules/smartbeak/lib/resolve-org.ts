import { ORPCError } from "@orpc/server";
import {
  getOrganizationBySlug,
  getSmartBeakOrgBySlug,
  upsertSmartBeakOrg,
} from "@repo/database";

interface ResolvedOrg {
  id: string;
  name: string;
  slug: string;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
  /** Supastarter organization ID (cuid) — use this for RBAC membership checks. */
  supastarterOrgId: string;
}

/**
 * Resolves a Supastarter organization slug into a SmartBeak organization
 * with a proper UUID id. If the SmartBeak org doesn't exist yet, it is
 * created automatically by syncing from the Supastarter org.
 *
 * Returns both the SmartBeak org (UUID id for data tables) and the
 * Supastarter org id (cuid for Better Auth membership checks).
 */
export async function resolveSmartBeakOrg(slug: string): Promise<ResolvedOrg> {
  const supastarterOrg = await getOrganizationBySlug(slug);
  if (!supastarterOrg) {
    throw new ORPCError("NOT_FOUND", {
      message: "Organization not found.",
    });
  }

  const existing = await getSmartBeakOrgBySlug(slug);
  if (existing) {
    return { ...existing, supastarterOrgId: supastarterOrg.id };
  }

  const [created] = await upsertSmartBeakOrg({
    id: crypto.randomUUID(),
    name: supastarterOrg.name,
    slug,
  });

  return { ...created, supastarterOrgId: supastarterOrg.id };
}
