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
    // Prevent javascript: URLs
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout'],
    // Keep the content of removed tags
    KEEP_CONTENT: true,
    // Prevent data URIs that could contain JavaScript
    FORBID_DATA_URI: true,
  };

  return DOMPurify.sanitize(html, config);
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
  
  // Block dangerous protocols
  const dangerousProtocols = [
    'javascript:',
    'data:text/html',
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

// Re-export DOMPurify for advanced use cases
export { DOMPurify };
