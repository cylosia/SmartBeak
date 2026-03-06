import type { MetadataRoute } from "next";
import { getBaseUrl } from "@repo/utils";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/app/", "/api/", "/auth/", "/image-proxy/"],
		},
		sitemap: `${getBaseUrl()}/sitemap.xml`,
	};
}
