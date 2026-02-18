/**
 * Bot Detection Utilities
 * Consolidated from apps/api/src/middleware/rateLimiter.ts
 */

/**
 * Suspicious user agent patterns for bot detection
 */
const SUSPICIOUS_USER_AGENTS = [
  'bot', 'crawler', 'spider', 'scrape', 'curl', 'wget',
  'python', 'java', 'scrapy', 'httpclient', 'axios',
  'postman', 'insomnia', 'burp', 'sqlmap', 'nikto',
  'nmap', 'masscan', 'zgrab', 'gobuster', 'dirbuster',
  'headless', 'phantomjs', 'selenium', 'puppeteer',
  'playwright', 'cypress', 'webdriver',
];

/**
 * Bot detection result
 */
export interface BotDetectionResult {
  isBot: boolean;
  confidence: number;
  indicators: string[];
}

/**
 * Detect potential bot/scraper based on request headers.
 * Uses a scoring system where a score >= 30 indicates bot-like behavior.
 *
 * @param headers - Request headers
 * @returns Bot detection result with score and indicators
 */
// Testing-framework UA substrings that should NOT trigger bot detection in
// non-production environments. Playwright, Cypress, and WebDriver are used by
// CI pipelines, integration tests, and visual regression runs.
const CI_TESTING_AGENTS = new Set(['playwright', 'cypress', 'webdriver']);

export function detectBot(headers: Record<string, string | string[] | undefined>): BotDetectionResult {
  const indicators: string[] = [];
  let score = 0;

  // Check user agent
  const userAgent = String(headers['user-agent'] || '').toLowerCase();

  // P3-FIX: Skip bot scoring for known CI/testing tool user agents in non-prod.
  // These patterns appear in Playwright/Cypress/WebDriver UAs used by integration
  // tests and visual regression pipelines — flagging them as bots blocks CI health
  // checks. Production keeps strict enforcement; other environments allow them.
  const isNonProduction = process.env['NODE_ENV'] !== 'production';
  const isCiTool = isNonProduction && [...CI_TESTING_AGENTS].some(p => userAgent.includes(p));
  if (isCiTool) {
    return { isBot: false, confidence: 0, indicators: [] };
  }

  if (!userAgent || userAgent.length < 10) {
    indicators.push('missing_user_agent');
    score += 30;
  } else {
    for (const pattern of SUSPICIOUS_USER_AGENTS) {
      if (userAgent.includes(pattern)) {
        indicators.push(`suspicious_ua:${pattern}`);
        score += 20;
        break;
      }
    }

    // Check for headless browser indicators
    if (userAgent.includes('headless') ||
        userAgent.includes('phantomjs') ||
        userAgent.includes('selenium') ||
        userAgent.includes('puppeteer') ||
        userAgent.includes('playwright')) {
      indicators.push('headless_browser');
      score += 25;
    }
  }

  // Check for missing/standard headers
  const acceptHeader = headers['accept'];
  if (!acceptHeader) {
    indicators.push('missing_accept_header');
    score += 15;
  }

  const acceptLanguage = headers['accept-language'];
  if (!acceptLanguage) {
    indicators.push('missing_accept_language');
    score += 10;
  }

  // Check for missing referer (not definitive, but adds to score)
  const referer = headers['referer'];
  if (!referer && !userAgent.includes('bot') && !userAgent.includes('crawler')) {
    indicators.push('missing_referer');
    score += 5;
  }

  // Determine bot status
  const isBot = score >= 30;
  const confidence = Math.min(score, 100);

  return { isBot, confidence, indicators };
}
