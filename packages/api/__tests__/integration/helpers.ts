/**
 * Integration test helpers for invoking oRPC procedure handlers directly.
 *
 * These helpers construct the context objects that procedures expect,
 * allowing tests to exercise the full procedure pipeline (middleware,
 * input validation, handler logic) without HTTP overhead.
 */

interface MockUser {
	id: string;
	name: string;
	email: string;
	role?: string;
}

interface MockSession {
	id: string;
	userId: string;
	activeOrganizationId?: string;
}

interface AuthenticatedContext {
	headers: Headers;
	session: MockSession;
	user: MockUser;
}

interface PublicContext {
	headers: Headers;
}

export function createAuthenticatedContext(
	overrides: Partial<MockUser> = {},
): AuthenticatedContext {
	const user: MockUser = {
		id: overrides.id ?? "test-user-id",
		name: overrides.name ?? "Test User",
		email: overrides.email ?? "test@example.com",
		role: overrides.role ?? "user",
		...overrides,
	};

	return {
		headers: new Headers({ "content-type": "application/json" }),
		session: {
			id: "test-session-id",
			userId: user.id,
			activeOrganizationId: undefined,
		},
		user,
	};
}

export function createPublicContext(): PublicContext {
	return {
		headers: new Headers({ "content-type": "application/json" }),
	};
}
