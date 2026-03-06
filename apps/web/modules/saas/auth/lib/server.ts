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

	if (!session) return null;

	const { token: _token, ...safeSession } = session.session as Record<string, unknown>;
	return {
		...session,
		session: safeSession,
	} as AppSession;
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
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[auth] getActiveOrganization failed:", err);
			}
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
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[auth] getOrganizationList failed:", err);
			}
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
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[auth] getUserAccounts failed:", err);
			}
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
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[auth] getUserPasskeys failed:", err);
			}
			return [];
		}
	},
);

export const getInvitation = cache(async (id: string) => {
	try {
		return await getInvitationById(id);
	} catch (err) {
		if (process.env.NODE_ENV !== "production") {
			console.warn("[auth] getInvitation failed:", err);
		}
		return null;
	}
});
