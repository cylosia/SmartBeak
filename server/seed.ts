import { domains } from "@shared/schema";
import { db } from "./db";
import { log } from "./index";

export async function seedDatabase() {
	try {
		const existing = await db.select().from(domains);
		if (existing.length > 0) {
			return;
		}

		await db.insert(domains).values([
			{
				name: "techreviews.io",
				theme: "affiliate-comparison",
				description:
					"Product comparison and tech review site with affiliate links",
				status: "active",
			},
			{
				name: "strategyhub.co",
				theme: "authority-site",
				description: "Business strategy and leadership knowledge hub",
				status: "active",
			},
			{
				name: "growthpilot.app",
				theme: "landing-leadgen",
				description:
					"SaaS lead generation landing page for GrowthPilot",
				status: "active",
			},
			{
				name: "joes-plumbing.com",
				theme: "local-business",
				description:
					"Local plumbing service website for Joe's Plumbing",
				status: "active",
			},
			{
				name: "morningbrief.news",
				theme: "media-newsletter",
				description: "Daily newsletter and media publication",
				status: "active",
			},
		]);

		log("Seeded 5 example domains", "seed");
	} catch (err) {
		log(
			`Seed error: ${err instanceof Error ? err.message : String(err)}`,
			"seed",
		);
	}
}
