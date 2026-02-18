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
    ALLOWED_TAGS: options.ALLOWED_TAGS || DEFAULT_ALLOWED_TAGS,
    ALLOWED_ATTR: options.ALLOWED_ATTR || DEFAULT_ALLOWED_ATTR,
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
    // Keep the content of removed tags
    KEEP_CONTENT: true,
    // Prevent data URIs that could contain JavaScript
    FORBID_DATA_URI: true,
  };

  // P0-FIX (P0-7): Add rel="noopener noreferrer" to all target="_blank" links
  // to prevent tabnabbing attacks where the opened page gains window.opener
  // access and can redirect the original tab to a phishing page.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // P1-7 FIX: Use try/finally so the hook is always removed even if sanitize() throws.
  // Also use removeHook (not removeAllHooks) to avoid destroying hooks registered
  // by other libraries sharing the same DOMPurify singleton.
  try {
    return DOMPurify.sanitize(html, config);
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
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

  const lowerUrl = url.toLowerCase().trim();
  
  // P1-8 FIX: Block ALL data: URIs, not just data:text/html.
  // data:image/svg+xml can embed <script> elements; data:text/javascript is obvious.
  // No legitimate use case for data: URIs in user-supplied href/src values.
  const dangerousProtocols = [
    'javascript:',
    'data:',
    'vbscript:',
    'mocha:',
    'livescript:',
    'about:',
    'file:',
  ];

  if (dangerousProtocols.some(proto => lowerUrl.startsWith(proto))) {
    return '';
  }

  return url;
}

// P3 FIX: DOMPurify singleton is no longer re-exported.
// Callers must use the sanitizeHtml() / sanitizeUrl() wrappers to ensure
// the configured allow-list and hook lifecycle are applied consistently.
