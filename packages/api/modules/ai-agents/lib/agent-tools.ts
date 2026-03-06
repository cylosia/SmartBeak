/**
 * Phase 3B — AI Agent Tools
 *
 * Defines the tool implementations that agents can invoke during execution.
 * Each tool is a typed function that the AI model can call via the Vercel AI SDK
 * `tools` parameter. Tools are registered by name and enabled per-agent via config.
 */

import { tool } from "@repo/ai";
import { z } from "zod";

// ─── SSRF Protection ─────────────────────────────────────────────────────────

const BLOCKED_HOST_RE =
	/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|\[::ffff:[\d.]+\]|\[fd[0-9a-f]{2}:.*\]|\[fe80:.*\])$/i;

function isSafeUrl(raw: string): boolean {
	try {
		const parsed = new URL(raw);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return false;
		}
		const hostname = parsed.hostname.toLowerCase();
		if (BLOCKED_HOST_RE.test(hostname)) {
			return false;
		}
		if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
			return false;
		}
		if (/^\d+$/.test(hostname)) {
			return false;
		}
		if (/^0[xo]/i.test(hostname)) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

// ─── Web Search Tool ──────────────────────────────────────────────────────────

/**
 * Performs a web search and returns a list of results.
 * In production, wire this to a search API (e.g., Brave Search, Serper, Tavily).
 */
export const webSearchTool = tool({
	description:
		"Search the web for up-to-date information on a topic. Returns titles, URLs, and snippets.",
	inputSchema: z.object({
		query: z.string().describe("The search query to execute."),
		maxResults: z
			.number()
			.int()
			.min(1)
			.max(10)
			.default(5)
			.describe("Maximum number of results to return."),
	}),
	execute: async ({ query, maxResults }) => {
		// Production: integrate with Brave Search API, Serper, or Tavily
		// For now, return a structured placeholder that the agent can reason about
		return {
			query,
			results: [
				{
					title: `Search result for: ${query}`,
					url: `https://example.com/search?q=${encodeURIComponent(query)}`,
					snippet: `Relevant information about ${query}. This would contain real search results in production.`,
				},
			].slice(0, maxResults),
			searchedAt: new Date().toISOString(),
		};
	},
});

// ─── Read URL Tool ────────────────────────────────────────────────────────────

/**
 * Fetches and extracts the text content of a URL.
 * Used by the Research Agent to read source material.
 */
export const readUrlTool = tool({
	description:
		"Fetch and extract the main text content from a URL. Use this to read articles, documentation, or web pages.",
	inputSchema: z.object({
		url: z.string().url().describe("The URL to fetch and read."),
	}),
	execute: async ({ url }) => {
		if (!isSafeUrl(url)) {
			return {
				url,
				error: "URL not allowed (private/internal addresses are blocked)",
				content: null,
			};
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10_000);
		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: { "User-Agent": "SmartBeak-AI-Agent/1.0" },
				redirect: "manual",
			});

			if (response.status >= 300 && response.status < 400) {
				return {
					url,
					error: "Redirects are not followed for security",
					content: null,
				};
			}
			if (!response.ok) {
				return { url, error: `HTTP ${response.status}`, content: null };
			}

			const html = await response.text();
			const text = html
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 8000);

			return { url, content: text, fetchedAt: new Date().toISOString() };
		} catch (err) {
			return {
				url,
				error: err instanceof Error ? err.message : "Fetch failed",
				content: null,
			};
		} finally {
			clearTimeout(timeout);
		}
	},
});

// ─── Fact Check Tool ──────────────────────────────────────────────────────────

/**
 * Evaluates a claim for factual accuracy by searching for corroborating sources.
 */
export const factCheckTool = tool({
	description:
		"Evaluate whether a specific claim or statement is factually accurate. Returns a confidence score and supporting evidence.",
	inputSchema: z.object({
		claim: z.string().describe("The claim or statement to fact-check."),
	}),
	execute: async ({ claim }) => {
		// Production: integrate with a fact-checking API or run a search + reasoning pass
		return {
			claim,
			verdict: "unverified" as
				| "true"
				| "false"
				| "unverified"
				| "misleading",
			confidence: 0.5,
			reasoning:
				"Automated fact-checking requires integration with a search API. Manual review recommended.",
			checkedAt: new Date().toISOString(),
		};
	},
});

// ─── Tool Registry ────────────────────────────────────────────────────────────

export const AGENT_TOOLS = {
	web_search: webSearchTool,
	read_url: readUrlTool,
	fact_check: factCheckTool,
} as const;

export type AgentToolName = keyof typeof AGENT_TOOLS;

/**
 * Returns only the tools that are enabled for a given agent config.
 */
export function getEnabledTools(
	toolNames: string[],
): Partial<typeof AGENT_TOOLS> {
	const enabled: Partial<typeof AGENT_TOOLS> = {};
	for (const name of toolNames) {
		if (name in AGENT_TOOLS) {
			(enabled as Record<string, unknown>)[name] =
				AGENT_TOOLS[name as AgentToolName];
		}
	}
	return enabled;
}
