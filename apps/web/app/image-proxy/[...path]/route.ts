import { auth } from "@repo/auth";
import { getSignedUrl } from "@repo/storage";
import { NextResponse } from "next/server";

export const GET = async (
	req: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) => {
	const session = await auth.api.getSession({ headers: req.headers });
	if (!session) {
		return new Response("Unauthorized", { status: 401 });
	}

	const { path } = await params;

	const [bucket, filePath] = path;

	if (!(bucket && filePath)) {
		return new Response("Invalid path", { status: 400 });
	}

	if (bucket === "avatars") {
		const signedUrl = await getSignedUrl(filePath, {
			bucket,
			expiresIn: 60 * 60,
		});

		return NextResponse.redirect(signedUrl, {
			headers: { "Cache-Control": "max-age=3600" },
		});
	}

	return new Response("Not found", {
		status: 404,
	});
};
