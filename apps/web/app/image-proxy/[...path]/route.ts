import { auth } from "@repo/auth";
import { getSignedUrl } from "@repo/storage";
import { NextResponse } from "next/server";

const ALLOWED_BUCKETS = new Set(["avatars"]);
const PATH_SEGMENT_REGEX = /^[a-zA-Z0-9._-]+$/;

export const GET = async (
	req: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) => {
	const session = await auth.api.getSession({ headers: req.headers });
	if (!session) {
		return new Response("Unauthorized", { status: 401 });
	}

	const { path } = await params;

	const [bucket, ...fileSegments] = path;
	const filePath = fileSegments.join("/");

	if (!(bucket && filePath)) {
		return new Response("Invalid path", { status: 400 });
	}

	if (!ALLOWED_BUCKETS.has(bucket)) {
		return new Response("Not found", { status: 404 });
	}

	if (
		filePath.includes("..") ||
		!fileSegments.every((seg) => PATH_SEGMENT_REGEX.test(seg))
	) {
		return new Response("Invalid path", { status: 400 });
	}

	if (fileSegments.length !== 1 && fileSegments.length < 3) {
		return new Response("Invalid path", { status: 400 });
	}

	const orgs = await auth.api.listOrganizations({
		headers: req.headers,
	});
	const orgIds = new Set(
		(orgs as Array<{ id: string }>).map((org) => org.id),
	);

	if (fileSegments.length === 1) {
		const objectId = fileSegments[0]?.replace(/\.[^.]+$/, "");
		const isOwnAvatar = objectId === session.user.id;
		const isOrgLogo = objectId ? orgIds.has(objectId) : false;

		if (!isOwnAvatar && !isOrgLogo) {
			return new Response("Forbidden", { status: 403 });
		}
	}

	if (fileSegments.length >= 3) {
		const orgId = fileSegments[0];
		const isMember = orgIds.has(orgId);
		if (!isMember) {
			return new Response("Forbidden", { status: 403 });
		}
	}

	const signedUrl = await getSignedUrl(filePath, {
		bucket,
		expiresIn: 60 * 60,
	});

	return NextResponse.redirect(signedUrl, {
		headers: { "Cache-Control": "max-age=3600" },
	});
};
