export interface SeoCheck {
	id: string;
	label: string;
	status: "pass" | "warning" | "fail";
	value: string;
	tip: string;
}

export interface SeoAnalysis {
	wordCount: number;
	readabilityScore: number;
	headingStructure: {
		hasH1: boolean;
		h2Count: number;
		isProperHierarchy: boolean;
	};
	keywordDensity: number | null;
	linkCount: { internal: number; external: number };
	overallScore: number;
	checks: SeoCheck[];
}

function stripHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => {
			switch (entity) {
				case "&amp;":
					return "&";
				case "&lt;":
					return "<";
				case "&gt;":
					return ">";
				case "&quot;":
					return '"';
				case "&#39;":
					return "'";
				default:
					return " ";
			}
		})
		.replace(/\s+/g, " ")
		.trim();
}

function classifyLinkHref(href: string): "internal" | "external" | null {
	const normalized = href.trim().toLowerCase();

	if (
		!normalized ||
		normalized.startsWith("#") ||
		normalized.startsWith("mailto:") ||
		normalized.startsWith("tel:") ||
		normalized.startsWith("javascript:") ||
		normalized.startsWith("data:")
	) {
		return null;
	}

	if (
		normalized.startsWith("http://") ||
		normalized.startsWith("https://") ||
		normalized.startsWith("//")
	) {
		return "external";
	}

	return "internal";
}

function countSyllables(word: string): number {
	const w = word.toLowerCase().replace(/[^a-z]/g, "");
	if (w.length <= 3) {
		return 1;
	}
	let count =
		w
			.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
			.replace(/^y/, "")
			.match(/[aeiouy]{1,2}/g)?.length ?? 1;
	if (count === 0) {
		count = 1;
	}
	return count;
}

function computeReadability(text: string): number {
	const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0 || sentences.length === 0) {
		return 0;
	}
	const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
	const score =
		206.835 -
		1.015 * (words.length / sentences.length) -
		84.6 * (totalSyllables / words.length);
	return Math.max(0, Math.min(100, Math.round(score)));
}

export function analyzeContent(
	html: string,
	targetKeyword?: string,
): SeoAnalysis {
	const text = stripHtml(html);
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	const wordCount = words.length;

	const readabilityScore = computeReadability(text);

	const h1Matches = html.match(/<h1[^>]*>/gi);
	const h2Matches = html.match(/<h2[^>]*>/gi);
	const _h3Matches = html.match(/<h3[^>]*>/gi);
	const hasH1 = (h1Matches?.length ?? 0) > 0;
	const h2Count = h2Matches?.length ?? 0;
	const headingOrder = html.match(/<h[1-6][^>]*>/gi) ?? [];
	const levels = headingOrder.map((h) => Number.parseInt(h.charAt(2), 10));
	let isProperHierarchy = true;
	for (let i = 1; i < levels.length; i++) {
		if (levels[i] > levels[i - 1] + 1) {
			isProperHierarchy = false;
			break;
		}
	}

	let keywordDensity: number | null = null;
	if (targetKeyword?.trim() && wordCount > 0) {
		const kw = targetKeyword.toLowerCase().trim();
		const textLower = text.toLowerCase();
		const regex = new RegExp(
			`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
			"gi",
		);
		const matches = textLower.match(regex);
		keywordDensity = ((matches?.length ?? 0) / wordCount) * 100;
	}

	const linkMatches =
		html.match(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1[^>]*>/gi) ?? [];
	let internal = 0;
	let external = 0;
	for (const link of linkMatches) {
		const hrefMatch = link.match(/\bhref\s*=\s*(['"])(.*?)\1/i);
		if (hrefMatch) {
			const href = hrefMatch[2];
			const classification = classifyLinkHref(href);
			if (classification === "external") {
				external++;
			} else if (classification === "internal") {
				internal++;
			}
		}
	}

	const checks: SeoCheck[] = [];

	// Word count
	if (wordCount >= 300 && wordCount <= 2000) {
		checks.push({
			id: "wordCount",
			label: "Word Count",
			status: "pass",
			value: `${wordCount}`,
			tip: "Good length for SEO",
		});
	} else if (wordCount < 300) {
		checks.push({
			id: "wordCount",
			label: "Word Count",
			status: "fail",
			value: `${wordCount}`,
			tip: "Aim for at least 300 words",
		});
	} else {
		checks.push({
			id: "wordCount",
			label: "Word Count",
			status: "warning",
			value: `${wordCount}`,
			tip: "Consider splitting into multiple articles",
		});
	}

	// Readability
	if (readabilityScore >= 60) {
		checks.push({
			id: "readability",
			label: "Readability",
			status: "pass",
			value: `${readabilityScore}/100`,
			tip: "Easy to read",
		});
	} else if (readabilityScore >= 30) {
		checks.push({
			id: "readability",
			label: "Readability",
			status: "warning",
			value: `${readabilityScore}/100`,
			tip: "Try shorter sentences",
		});
	} else {
		checks.push({
			id: "readability",
			label: "Readability",
			status: "fail",
			value: `${readabilityScore}/100`,
			tip: "Simplify your language",
		});
	}

	// Heading structure
	if (hasH1 && h2Count >= 2 && isProperHierarchy) {
		checks.push({
			id: "headings",
			label: "Headings",
			status: "pass",
			value: `H1: ${h1Matches?.length ?? 0}, H2: ${h2Count}`,
			tip: "Well structured",
		});
	} else if (hasH1) {
		checks.push({
			id: "headings",
			label: "Headings",
			status: "warning",
			value: `H2: ${h2Count}`,
			tip: "Add more H2 subheadings",
		});
	} else {
		checks.push({
			id: "headings",
			label: "Headings",
			status: "fail",
			value: "Missing H1",
			tip: "Add an H1 heading",
		});
	}

	// Keyword density
	if (keywordDensity !== null) {
		if (keywordDensity >= 0.5 && keywordDensity <= 2.5) {
			checks.push({
				id: "keyword",
				label: "Keyword Density",
				status: "pass",
				value: `${keywordDensity.toFixed(1)}%`,
				tip: "Good keyword usage",
			});
		} else if (keywordDensity > 2.5) {
			checks.push({
				id: "keyword",
				label: "Keyword Density",
				status: "warning",
				value: `${keywordDensity.toFixed(1)}%`,
				tip: "Reduce keyword stuffing",
			});
		} else {
			checks.push({
				id: "keyword",
				label: "Keyword Density",
				status: "fail",
				value: `${keywordDensity.toFixed(1)}%`,
				tip: "Use your keyword more often",
			});
		}
	}

	// Links
	const totalLinks = internal + external;
	if (totalLinks >= 2) {
		checks.push({
			id: "links",
			label: "Links",
			status: "pass",
			value: `${internal} int, ${external} ext`,
			tip: "Good linking",
		});
	} else if (totalLinks >= 1) {
		checks.push({
			id: "links",
			label: "Links",
			status: "warning",
			value: `${totalLinks} total`,
			tip: "Add more links",
		});
	} else {
		checks.push({
			id: "links",
			label: "Links",
			status: "fail",
			value: "0",
			tip: "Add internal and external links",
		});
	}

	// Overall score
	const passCount = checks.filter((c) => c.status === "pass").length;
	const totalChecks = checks.length;
	const overallScore =
		totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 0;

	return {
		wordCount,
		readabilityScore,
		headingStructure: { hasH1, h2Count, isProperHierarchy },
		keywordDensity,
		linkCount: { internal, external },
		overallScore,
		checks,
	};
}
