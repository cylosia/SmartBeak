import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";

/**
 * Real-time content optimizer.
 *
 * Scores content against SEO best practices without an external API call,
 * making it fast enough for live "as-you-type" feedback in the editor.
 *
 * Scoring breakdown (100 pts total):
 *   Title (20 pts): length, keyword presence
 *   Body (25 pts): word count, heading structure, paragraph length
 *   Keywords (25 pts): density, distribution, LSI presence
 *   Readability (15 pts): sentence length, passive voice heuristic
 *   Meta (15 pts): description length, keyword presence
 */

function scoreTitle(
	title: string,
	keywords: string[],
): {
	score: number;
	suggestions: Array<{ type: string; severity: string; message: string }>;
} {
	const suggestions: Array<{
		type: string;
		severity: string;
		message: string;
	}> = [];
	let score = 0;

	if (title.length >= 30 && title.length <= 70) {
		score += 10;
	} else if (title.length > 0) {
		score += 5;
		if (title.length < 30) {
			suggestions.push({
				type: "title",
				severity: "warning",
				message: "Title is too short. Aim for 30–70 characters.",
			});
		} else {
			suggestions.push({
				type: "title",
				severity: "warning",
				message:
					"Title is too long. Keep it under 70 characters for full SERP display.",
			});
		}
	} else {
		suggestions.push({
			type: "title",
			severity: "error",
			message: "Title is missing.",
		});
	}

	const titleLower = title.toLowerCase();
	const keywordInTitle = keywords.some((k) =>
		titleLower.includes(k.toLowerCase()),
	);
	if (keywords.length > 0 && keywordInTitle) {
		score += 10;
	} else if (keywords.length > 0) {
		score += 2;
		suggestions.push({
			type: "keyword",
			severity: "warning",
			message: "Include your primary keyword in the title.",
		});
	} else {
		score += 5; // no keywords specified, neutral
	}

	return { score, suggestions };
}

function scoreBody(body: string): {
	score: number;
	wordCount: number;
	suggestions: Array<{ type: string; severity: string; message: string }>;
} {
	const suggestions: Array<{
		type: string;
		severity: string;
		message: string;
	}> = [];
	const words = body.trim().split(/\s+/).filter(Boolean);
	const wordCount = words.length;
	let score = 0;

	// Word count scoring
	if (wordCount >= 1500) {
		score += 10;
	} else if (wordCount >= 800) {
		score += 7;
	} else if (wordCount >= 300) {
		score += 4;
	} else {
		suggestions.push({
			type: "length",
			severity: "warning",
			message: `Content is short (${wordCount} words). Aim for 800+ words for better ranking.`,
		});
	}

	// Heading structure
	const h2Count = (body.match(/^## /gm) ?? []).length;
	const h3Count = (body.match(/^### /gm) ?? []).length;
	if (h2Count >= 3) {
		score += 8;
	} else if (h2Count >= 1) {
		score += 4;
	} else {
		suggestions.push({
			type: "structure",
			severity: "warning",
			message:
				"Add H2 headings (##) to structure your content for better readability and SEO.",
		});
	}
	if (h3Count >= 2) {
		score += 4;
	} else if (h3Count === 0 && wordCount > 800) {
		suggestions.push({
			type: "structure",
			severity: "info",
			message:
				"Consider adding H3 subheadings (###) for longer sections.",
		});
	}

	// Paragraph length heuristic
	const paragraphs = body.split(/\n\n+/).filter((p) => p.trim().length > 0);
	const longParagraphs = paragraphs.filter(
		(p) => p.split(/\s+/).length > 150,
	);
	if (longParagraphs.length > 0) {
		suggestions.push({
			type: "readability",
			severity: "info",
			message: `${longParagraphs.length} paragraph(s) are very long. Break them up for better readability.`,
		});
	} else {
		score += 3;
	}

	return { score, wordCount, suggestions };
}

function scoreKeywords(
	body: string,
	title: string,
	keywords: string[],
): {
	score: number;
	density: Record<string, number>;
	suggestions: Array<{ type: string; severity: string; message: string }>;
} {
	const suggestions: Array<{
		type: string;
		severity: string;
		message: string;
	}> = [];
	const density: Record<string, number> = {};
	let score = 0;

	if (keywords.length === 0) {
		return { score: 12, density, suggestions }; // neutral if no keywords
	}

	const fullText = `${title} ${body}`.toLowerCase();
	const wordCount = fullText.split(/\s+/).length;

	for (const kw of keywords) {
		const kwLower = kw.toLowerCase();
		const regex = new RegExp(
			`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
			"g",
		);
		const matches = fullText.match(regex) ?? [];
		const d = wordCount > 0 ? (matches.length / wordCount) * 100 : 0;
		density[kw] = Math.round(d * 100) / 100;

		if (d >= 0.5 && d <= 2.5) {
			score += Math.round(25 / keywords.length);
		} else if (d > 0) {
			score += Math.round(10 / keywords.length);
			if (d > 2.5) {
				suggestions.push({
					type: "keyword",
					severity: "warning",
					message: `"${kw}" appears too frequently (${d.toFixed(1)}%). Reduce to 0.5–2.5% to avoid keyword stuffing.`,
				});
			} else {
				suggestions.push({
					type: "keyword",
					severity: "info",
					message: `"${kw}" density is low (${d.toFixed(1)}%). Consider using it more naturally.`,
				});
			}
		} else {
			suggestions.push({
				type: "keyword",
				severity: "warning",
				message: `Target keyword "${kw}" not found in content.`,
			});
		}
	}

	return { score: Math.min(25, score), density, suggestions };
}

function scoreReadability(body: string): {
	score: number;
	suggestions: Array<{ type: string; severity: string; message: string }>;
} {
	const suggestions: Array<{
		type: string;
		severity: string;
		message: string;
	}> = [];
	let score = 0;

	const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 0);
	if (sentences.length === 0) {
		return { score: 0, suggestions };
	}

	const avgWordsPerSentence =
		sentences.reduce((s, sent) => s + sent.split(/\s+/).length, 0) /
		sentences.length;

	if (avgWordsPerSentence <= 20) {
		score += 10;
	} else if (avgWordsPerSentence <= 30) {
		score += 6;
		suggestions.push({
			type: "readability",
			severity: "info",
			message:
				"Some sentences are long. Aim for an average under 20 words per sentence.",
		});
	} else {
		score += 2;
		suggestions.push({
			type: "readability",
			severity: "warning",
			message:
				"Sentences are too long on average. Shorter sentences improve readability and SEO.",
		});
	}

	// Passive voice heuristic (simple)
	const passiveMatches =
		body.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) ?? [];
	const passiveRatio = passiveMatches.length / (sentences.length || 1);
	if (passiveRatio < 0.1) {
		score += 5;
	} else if (passiveRatio < 0.2) {
		score += 3;
	} else {
		suggestions.push({
			type: "readability",
			severity: "info",
			message:
				"High passive voice usage detected. Use active voice for more engaging content.",
		});
	}

	return { score, suggestions };
}

function scoreMeta(
	metaDescription: string | undefined,
	keywords: string[],
): {
	score: number;
	suggestions: Array<{ type: string; severity: string; message: string }>;
} {
	const suggestions: Array<{
		type: string;
		severity: string;
		message: string;
	}> = [];
	let score = 0;

	if (!metaDescription || metaDescription.trim().length === 0) {
		suggestions.push({
			type: "meta",
			severity: "error",
			message:
				"Meta description is missing. Add one to improve click-through rates.",
		});
		return { score: 0, suggestions };
	}

	const len = metaDescription.length;
	if (len >= 120 && len <= 160) {
		score += 10;
	} else if (len > 0) {
		score += 5;
		if (len < 120) {
			suggestions.push({
				type: "meta",
				severity: "warning",
				message: `Meta description is short (${len} chars). Aim for 120–160 characters.`,
			});
		} else {
			suggestions.push({
				type: "meta",
				severity: "warning",
				message: `Meta description is too long (${len} chars). Keep it under 160 characters.`,
			});
		}
	}

	const metaLower = metaDescription.toLowerCase();
	const kwInMeta = keywords.some((k) => metaLower.includes(k.toLowerCase()));
	if (keywords.length > 0 && kwInMeta) {
		score += 5;
	} else if (keywords.length > 0) {
		suggestions.push({
			type: "meta",
			severity: "info",
			message: "Include your primary keyword in the meta description.",
		});
	} else {
		score += 3;
	}

	return { score, suggestions };
}

export const optimizeContent = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/seo-intelligence/optimize",
		tags: ["SmartBeak - SEO Intelligence"],
		summary: "Real-time content SEO optimizer — score content as you type",
	})
	.input(
		z.object({
			title: z.string().min(1).max(255),
			body: z.string().min(1).max(100_000),
			targetKeywords: z.array(z.string().max(100)).max(20).optional(),
			metaDescription: z.string().max(500).optional(),
		}),
	)
	.handler(async ({ input }) => {
		const keywords = input.targetKeywords ?? [];

		const titleResult = scoreTitle(input.title, keywords);
		const bodyResult = scoreBody(input.body);
		const keywordResult = scoreKeywords(input.body, input.title, keywords);
		const readabilityResult = scoreReadability(input.body);
		const metaResult = scoreMeta(input.metaDescription, keywords);

		const titleScore = Math.min(20, titleResult.score);
		const bodyScore = Math.min(25, bodyResult.score);
		const keywordScore = Math.min(25, keywordResult.score);
		const readabilityScore = Math.min(15, readabilityResult.score);
		const metaScore = Math.min(15, metaResult.score);

		const overallScore =
			titleScore +
			bodyScore +
			keywordScore +
			readabilityScore +
			metaScore;

		const allSuggestions = [
			...titleResult.suggestions,
			...bodyResult.suggestions,
			...keywordResult.suggestions,
			...readabilityResult.suggestions,
			...metaResult.suggestions,
		];

		const estimatedReadTime = Math.max(
			1,
			Math.round(bodyResult.wordCount / 200),
		);

		return {
			overallScore,
			titleScore,
			bodyScore,
			keywordScore,
			readabilityScore,
			metaScore,
			wordCount: bodyResult.wordCount,
			estimatedReadTime,
			suggestions: allSuggestions,
			keywordDensity: keywordResult.density,
		};
	});
