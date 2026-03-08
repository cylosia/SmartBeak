import { escapeHtml } from "@repo/utils";

interface ThemeConfig {
	name: string;
	description: string;
	primaryColor: string;
	fontFamily: string;
}

export const THEME_IDS = [
	"affiliate-comparison",
	"authority-site",
	"landing-leadgen",
	"local-business",
	"media-newsletter",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_CONFIGS: Record<ThemeId, ThemeConfig> = {
	"affiliate-comparison": {
		name: "Affiliate Comparison",
		description: "Product comparison website template",
		primaryColor: "#6366f1",
		fontFamily: "'Inter', sans-serif",
	},
	"authority-site": {
		name: "Authority Site",
		description: "Editorial content and knowledge-site template",
		primaryColor: "#0f172a",
		fontFamily: "'Merriweather', serif",
	},
	"landing-leadgen": {
		name: "Landing Page - Lead Gen",
		description: "Lead-generation landing page template",
		primaryColor: "#059669",
		fontFamily: "'Plus Jakarta Sans', sans-serif",
	},
	"local-business": {
		name: "Local Business",
		description: "Local business website template",
		primaryColor: "#dc2626",
		fontFamily: "'Open Sans', sans-serif",
	},
	"media-newsletter": {
		name: "Media & Newsletter",
		description: "Media publication and newsletter template",
		primaryColor: "#7c3aed",
		fontFamily: "'Playfair Display', serif",
	},
};

function baseTemplate(
	domainName: string,
	title: string,
	color: string,
	body: string,
): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${domainName} - ${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;color:#1e293b;background:#fff}
.nav{border-bottom:1px solid #e2e8f0;padding:16px 0}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:700;font-size:1.5rem;color:${color}}
.hero{background:linear-gradient(135deg,${color} 0%,${color}cc 100%);padding:80px 0;text-align:center;color:#fff}
.hero h1{font-size:3rem;font-weight:700;margin-bottom:16px}
.hero p{font-size:1.15rem;opacity:.9;max-width:600px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;padding:64px 0}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:32px}
.card h3{font-size:1.15rem;font-weight:600;margin-bottom:8px}
.card p{color:#64748b;line-height:1.6}
.footer{background:#0f172a;color:#94a3b8;padding:32px 0;text-align:center;font-size:.875rem}
</style>
</head>
<body>
${body}
<footer class="footer"><div class="container"><p>${domainName} &bull; Built with SmartBeak SmartDeploy</p></div></footer>
</body></html>`;
}

function generateAffiliateComparison(d: string): string {
	return baseTemplate(
		d,
		"Best Product Comparisons",
		"#6366f1",
		`
<nav class="nav"><div class="container"><div class="nav-inner"><div class="logo">${d}</div></div></div></nav>
<section class="hero"><div class="container"><h1>Build Your Comparison Site</h1><p>Use this sample layout for comparisons and buying guides after replacing the example rankings and review claims.</p></div></section>
<div class="container"><div class="grid">
<div class="card"><h3>Laptops & Computers</h3><p>Compare specs, performance, and value across top brands.</p></div>
<div class="card"><h3>Smartphones</h3><p>Side-by-side phone comparisons with camera tests and battery life.</p></div>
<div class="card"><h3>Audio & Headphones</h3><p>Find the best headphones and audio gear for your needs.</p></div>
</div></div>`,
	);
}

function generateAuthoritySite(d: string): string {
	return baseTemplate(
		d,
		"Expert Knowledge Hub",
		"#0f172a",
		`
<nav class="nav"><div class="container"><div class="nav-inner"><div class="logo">${d}</div></div></div></nav>
<section class="hero" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%)"><div class="container"><h1>Publish Your Expertise Carefully</h1><p>Use this editorial template for articles or guides after replacing the sample authority claims with your real content.</p></div></section>
<div class="container"><div class="grid">
<div class="card"><h3>Strategic Decision Making</h3><p>Frameworks and mental models that top executives use.</p></div>
<div class="card"><h3>Market Dynamics</h3><p>Data-driven approaches to understanding market shifts.</p></div>
<div class="card"><h3>Building Resilient Systems</h3><p>Key principles for creating systems that thrive under uncertainty.</p></div>
</div></div>`,
	);
}

function generateLandingLeadgen(d: string): string {
	return baseTemplate(
		d,
		"Transform Your Business",
		"#059669",
		`
<nav class="nav"><div class="container"><div class="nav-inner"><div class="logo">${d}</div></div></div></nav>
<section class="hero"><div class="container"><h1>Present Your Business Clearly Online</h1><p>Use this starter layout as a customizable landing page template for your business and offers.</p></div></section>
<div class="container"><div class="grid">
<div class="card"><h3>Lightning Fast Setup</h3><p>Get up and running in minutes, not days.</p></div>
<div class="card"><h3>Performance Highlights</h3><p>Replace this sample block with the metrics, reporting, or insights your business actually provides.</p></div>
<div class="card"><h3>Customizable Trust Section</h3><p>Replace this placeholder with your actual security, privacy, or compliance commitments before publishing.</p></div>
</div></div>`,
	);
}

function generateLocalBusiness(d: string): string {
	return baseTemplate(
		d,
		"Your Local Business",
		"#dc2626",
		`
<nav class="nav"><div class="container"><div class="nav-inner"><div class="logo">${d}</div></div></div></nav>
<section class="hero"><div class="container"><h1>Describe Your Local Business Clearly</h1><p>Use this starter layout to present your real services, service area, and contact details before publishing.</p></div></section>
<div class="container"><div class="grid">
<div class="card"><h3>Maintenance</h3><p>Regular upkeep to keep everything running smoothly.</p></div>
<div class="card"><h3>Repairs</h3><p>Describe the repair or support work you actually provide, including any real service commitments you want to publish.</p></div>
<div class="card"><h3>Consultation</h3><p>Expert advice to help you make informed decisions.</p></div>
</div></div>`,
	);
}

function generateMediaNewsletter(d: string): string {
	return baseTemplate(
		d,
		"Stories That Matter",
		"#7c3aed",
		`
<nav class="nav"><div class="container"><div class="nav-inner"><div class="logo">${d}</div></div></div></nav>
<section class="hero"><div class="container"><h1>Publish Your Stories and Updates</h1><p>Use this media or newsletter template for your real editorial voice, publishing cadence, and subscription offer.</p></div></section>
<div class="container"><div class="grid">
<div class="card"><h3>Technology</h3><p>The quiet revolution reshaping how we work and live.</p></div>
<div class="card"><h3>Culture</h3><p>Bridging worlds through the new global creative movement.</p></div>
<div class="card"><h3>Innovation</h3><p>Inside the next wave of sustainable innovation.</p></div>
</div></div>`,
	);
}

export function generateThemeHtml(themeId: string, domainName: string): string {
	const safeName = escapeHtml(domainName);
	switch (themeId) {
		case "affiliate-comparison":
			return generateAffiliateComparison(safeName);
		case "authority-site":
			return generateAuthoritySite(safeName);
		case "landing-leadgen":
			return generateLandingLeadgen(safeName);
		case "local-business":
			return generateLocalBusiness(safeName);
		case "media-newsletter":
			return generateMediaNewsletter(safeName);
		default:
			return generateLandingLeadgen(safeName);
	}
}
