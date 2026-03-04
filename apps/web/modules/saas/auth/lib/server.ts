import "server-only";
import type { ActiveOrganization, Organization } from "@repo/auth";
import { auth } from "@repo/auth";
import { getInvitationById } from "@repo/database";
import { headers } from "next/headers";
import { cache } from "react";

interface AppSession {
	session: {
		id: string;
		userId: string;
		expiresAt: Date;
		token: string;
		createdAt: Date;
		updatedAt: Date;
		ipAddress?: string | null;
		userAgent?: string | null;
		impersonatedBy?: string | null;
		activeOrganizationId?: string | null;
	};
	user: {
		id: string;
		name: string;
		email: string;
		emailVerified: boolean;
		image?: string | null;
		createdAt: Date;
		updatedAt: Date;
		role?: string | null;
		banned?: boolean | null;
		banReason?: string | null;
		banExpires?: Date | null;
		onboardingComplete?: boolean | null;
		locale?: string | null;
		twoFactorEnabled?: boolean | null;
		username?: string | null;
	};
}

export const getSession = cache(async (): Promise<AppSession | null> => {
	const session = await auth.api.getSession({
		headers: await headers(),
		query: {
			disableCookieCache: true,
		},
	});

	return session as AppSession | null;
});

export const getActiveOrganization = cache(
	async (slug: string): Promise<ActiveOrganization | null> => {
		try {
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
