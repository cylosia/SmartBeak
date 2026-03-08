import { getSignedUploadUrl } from "@repo/storage";
import z from "zod";
import { protectedProcedure } from "../../../orpc/procedures";

export const createAvatarUploadUrl = protectedProcedure
	.route({
		method: "POST",
		path: "/users/avatar-upload-url",
		tags: ["Users"],
		summary: "Create avatar upload URL",
		description:
			"Create a signed upload URL to upload an avatar image to the storage bucket",
	})
	.input(
		z.object({
			size: z
				.number()
				.int()
				.positive()
				.max(5 * 1024 * 1024),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const path = `${user.id}.png`;
		const signedUploadUrl = await getSignedUploadUrl(`${user.id}.png`, {
			bucket: "avatars",
			size: input.size,
		});

		return { signedUploadUrl, path };
	});
