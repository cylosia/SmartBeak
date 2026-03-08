import { getOrganizationBySlug } from "@repo/database";
import slugify from "@sindresorhus/slugify";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { publicRateLimitMiddleware } from "../../../orpc/middleware/rate-limit-middleware";
import { publicProcedure } from "../../../orpc/procedures";

const randomSlugSuffix = customAlphabet(
	"abcdefghijklmnopqrstuvwxyz0123456789",
	6,
);

export const generateOrganizationSlug = publicProcedure
	.route({
		method: "GET",
		path: "/organizations/generate-slug",
		tags: ["Organizations"],
		summary: "Generate organization slug",
		description: "Generate a unique slug from an organization name",
	})
	.input(
		z.object({
			name: z.string().min(1).max(255),
		}),
	)
	.use(publicRateLimitMiddleware({ limit: 15, windowMs: 60_000 }))
	.handler(async ({ input: { name } }) => {
		const generatedSlug = slugify(name, {
			lowercase: true,
		});
		const baseSlug = generatedSlug || `organization-${randomSlugSuffix()}`;

		let slug = baseSlug;
		const existing = await getOrganizationBySlug(slug);
		if (existing) {
			slug = `${baseSlug}-${randomSlugSuffix()}`;
		}

		return { slug };
	});
