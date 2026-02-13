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
export function detectBot(headers: Record<string, string | string[] | undefined>): BotDetectionResult {
  const indicators: string[] = [];
  let score = 0;

  // Check user agent
  const userAgent = String(headers['user-agent'] || '').toLowerCase();

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
