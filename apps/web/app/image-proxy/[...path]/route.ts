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

	const signedUrl = await getSignedUrl(filePath, {
		bucket,
		expiresIn: 60 * 60,
	});

	return NextResponse.redirect(signedUrl, {
		headers: { "Cache-Control": "max-age=3600" },
	});
};
