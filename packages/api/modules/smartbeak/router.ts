import { aiIdeasRouter } from "./ai-ideas/router";
import { analyticsRoiRouter } from "./analytics-roi/router";
import { auditRouter } from "./audit/router";
import { billingRouter } from "./billing/router";
import { contentRouter } from "./content/router";
import { deployRouter } from "./deploy/router";
import { domainsRouter } from "./domains/router";
import { growthRouter } from "./growth/router";
import { mediaRouter } from "./media/router";
import { onboardingRouter } from "./onboarding/router";
import { portfolioRouter } from "./portfolio/router";
import { publishingRouter } from "./publishing/router";
import { publishingSuiteRouter } from "./publishing-suite/router";
import { seoRouter } from "./seo/router";
import { seoIntelligenceRouter } from "./seo-intelligence/router";
import { settingsRouter } from "./settings/router";

export const smartbeakRouter = {
	domains: domainsRouter,
	content: contentRouter,
	media: mediaRouter,
	publishing: publishingRouter,
	seo: seoRouter,
	billing: billingRouter,
	audit: auditRouter,
	onboarding: onboardingRouter,
	aiIdeas: aiIdeasRouter,
	portfolio: portfolioRouter,
	seoIntelligence: seoIntelligenceRouter,
	settings: settingsRouter,
	deploy: deployRouter,
	publishingSuite: publishingSuiteRouter,
	analyticsRoi: analyticsRoiRouter,
	growth: growthRouter,
};
