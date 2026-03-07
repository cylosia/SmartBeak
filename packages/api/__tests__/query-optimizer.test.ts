import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/logs", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { decodeCursor, encodeCursor } from "../infrastructure/query-optimizer";

describe("encodeCursor / decodeCursor", () => {
	it("roundtrips a valid cursor", () => {
		const createdAt = new Date("2025-06-15T12:30:00.000Z");
		const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

		const cursor = encodeCursor(createdAt, id);
		const decoded = decodeCursor(cursor);

		expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
		expect(decoded.id).toBe(id);
	});

	it("throws on a cursor with no Z: separator", () => {
		const noSep = Buffer.from("noseparator").toString("base64url");
		expect(() => decodeCursor(noSep)).toThrow("missing separator");
	});

	it("throws on a cursor with a malformed date before Z:", () => {
		const badDate = Buffer.from("not-a-dateZ:some-id").toString(
			"base64url",
		);
		expect(() => decodeCursor(badDate)).toThrow("malformed date");
	});

	it("throws on garbage input without Z: boundary", () => {
		const noSep = Buffer.from("garbage").toString("base64url");
		expect(() => decodeCursor(noSep)).toThrow("missing separator");
	});
});
