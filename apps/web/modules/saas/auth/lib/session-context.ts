import React from "react";

interface AppSessionData {
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
}

interface AppUserData {
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
}

export const SessionContext = React.createContext<
	| {
			session: AppSessionData | null;
			user: AppUserData | null;
			loaded: boolean;
			reloadSession: () => Promise<void>;
	  }
	| undefined
>(undefined);
