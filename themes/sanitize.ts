/**
 * HTML Sanitization Utility for Theme Templates
 * Prevents XSS attacks by sanitizing HTML content
 * 
 * P0-FIX: Replaced regex-based sanitization with DOMPurify for robust XSS protection
 */

import DOMPurify from 'isomorphic-dompurify';

interface SanitizeOptions {
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
}

const DEFAULT_ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'];
const DEFAULT_ALLOWED_ATTR = ['href', 'title', 'target'];

/**
 * Sanitize HTML content to prevent XSS attacks
 * P0-FIX: Uses DOMPurify for robust XSS protection instead of regex-based sanitization
 * 
 * @param html - Raw HTML content
 * @param options - Sanitization options
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string | undefined | null, options: SanitizeOptions = {}): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // P0-FIX: Use DOMPurify for robust XSS protection
  const config: DOMPurify.Config = {
    ALLOWED_TAGS: options.ALLOWED_TAGS ?? DEFAULT_ALLOWED_TAGS,
    ALLOWED_ATTR: options.ALLOWED_ATTR ?? DEFAULT_ALLOWED_ATTR,
    // P0-FIX (P0-6): Expanded FORBID_ATTR to block 'style' (CSS expression injection)
    // and all event handler attributes not already covered by DOMPurify defaults.
    FORBID_ATTR: [
      'style',
      'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout',
      'onmousemove', 'onmouseenter', 'onmouseleave',
      'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset',
      'onkeydown', 'onkeyup', 'onkeypress',
      'ondblclick', 'oncontextmenu', 'ondrag', 'ondrop',
      'onscroll', 'onwheel', 'onresize', 'onselect',
      'formaction', 'form',
    ],
    // Discard content of removed tags to prevent mutation XSS
    KEEP_CONTENT: false,
    // Prevent data URIs that could contain JavaScript
    FORBID_DATA_URI: true,
  };

  const sanitized = DOMPurify.sanitize(html, config);

  // P0-FIX: Replace addHook/removeAllHooks with post-processing string manipulation.
  // Under concurrent SSR (Next.js App Router renders requests in parallel), using
  // DOMPurify.addHook() mutates the global singleton and removeAllHooks() removes
  // hooks belonging to other concurrent requests, causing intermittent tabnapping
  // vulnerability. Post-processing the sanitized string is thread-safe.
  //
  // After DOMPurify sanitization the only remaining <a ...> tags are safe;
  // we add rel="noopener noreferrer" to any that have target="_blank".
  const result = sanitized.replace(
    /(<a\b[^>]*)\btarget=["']_blank["']([^>]*>)/gi,
    (_match, before, after) => {
      // If rel is already present, augment it; otherwise add it.
      if (/\brel=/i.test(before) || /\brel=/i.test(after)) {
        return `${before}target="_blank"${after}`.replace(
          /\brel=(["'])(.*?)\1/i,
          (_r, q, v) => `rel=${q}${v.includes('noopener') ? v : `${v} noopener noreferrer`.trim()}${q}`
        );
      }
      return `${before}target="_blank" rel="noopener noreferrer"${after}`;
    }
  );

  return result;
}

/**
 * Sanitize URL to prevent javascript: protocol injection
 * @param url - URL to sanitize
 * @returns Sanitized URL or empty string if unsafe
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();

  // Use URL parsing for structural validation — string prefix matching cannot
  // reliably catch "https:// evil.com" (space injection) or encoded variants.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }

  // Only allow explicit safe protocols.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '';
  }

  return trimmed;
}

// DOMPurify is intentionally not re-exported: exposing the singleton allows
// callers to install persistent hooks that corrupt concurrent SSR requests.
