import "server-only";
import type { ActiveOrganization, Organization } from "@repo/auth";
import { auth } from "@repo/auth";
import { getInvitationById } from "@repo/database";
import { headers } from "next/headers";
import { cache } from "react";

export const getSession = cache(async () => {
	const session = await auth.api.getSession({
		headers: await headers(),
		query: {
			disableCookieCache: true,
		},
	});

	return session;
});

export const getActiveOrganization = cache(
	async (slug: string): Promise<ActiveOrganization | null> => {
		try {
			// @ts-expect-error better-auth organization plugin method
			const activeOrganization = await auth.api.getFullOrganization({
				query: {
					organizationSlug: slug,
				},
				headers: await headers(),
			});

			return activeOrganization as ActiveOrganization;
		} catch {
			return null;
		}
	},
);

export const getOrganizationList = cache(
	async (): Promise<Organization[]> => {
		try {
			// @ts-expect-error better-auth organization plugin method
			const organizationList = await auth.api.listOrganizations({
				headers: await headers(),
			});

			return organizationList as Organization[];
		} catch {
			return [];
		}
	},
);

export const getUserAccounts = cache(
	async (): Promise<{ providerId: string; accountId: string }[]> => {
		try {
			// @ts-expect-error better-auth plugin method
			const userAccounts = await auth.api.listUserAccounts({
				headers: await headers(),
			});

			return userAccounts as { providerId: string; accountId: string }[];
		} catch {
			return [];
		}
	},
);

export const getUserPasskeys = cache(
	async (): Promise<{ id: string; name?: string | null; createdAt: Date }[]> => {
		try {
			// @ts-expect-error better-auth passkey plugin method
			const userPasskeys = await auth.api.listPasskeys({
				headers: await headers(),
			});

			return userPasskeys as { id: string; name?: string | null; createdAt: Date }[];
		} catch {
			return [];
		}
	},
);

export const getInvitation = cache(async (id: string) => {
	try {
		return await getInvitationById(id);
	} catch {
		return null;
	}
});
