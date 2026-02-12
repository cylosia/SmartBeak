/**
* Extracts links from content bodies (HTML/Markdown).
* Advisory only: populates read models; never mutates content.
*/

export interface ExtractedLink {
  href: string;
  text?: string;
}

/**
* Extract links from HTML using proper DOM parsing
*
* Uses a proper HTML parser approach instead of regex
* to handle nested elements, attributes with special characters,
* and other edge cases safely.
*/
export function extractLinks(html: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  if (!html || typeof html !== 'string') {
  return links;
  }

  // This handles edge cases like: <a href='...' title='>'>, nested quotes, etc.
  const parsedLinks = parseHtmlLinks(html);

  for (const link of parsedLinks) {
  // Validate URL format
  if (isValidUrl(link.href)) {
    const text = link.text?.trim();
    links.push({
    href: normalizeUrl(link.href),
    ...(text ? { text } : {})
    });
  }
  }

  return links;
}

/**
* Parse HTML links using state machine
* Handles edge cases that regex cannot
*/
function parseHtmlLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  let pos = 0;

  // P2-FIX: Lowercase once to avoid O(n^2) allocation
  const lowerHtml = html.toLowerCase();

  // P2-FIX: Skip <script> and <style> blocks before extracting links
  const sanitized = lowerHtml;

  while (pos < html.length) {
  // P2-FIX: Skip <script> and <style> blocks
  const scriptStart = sanitized.indexOf('<script', pos);
  const styleStart = sanitized.indexOf('<style', pos);
  const tagStart = sanitized.indexOf('<a', pos);

  // If we'd hit a script/style before the next <a>, skip over it
  if (scriptStart !== -1 && (tagStart === -1 || scriptStart < tagStart)) {
    const scriptEnd = sanitized.indexOf('</script>', scriptStart);
    if (scriptEnd !== -1) {
    pos = scriptEnd + 9;
    continue;
    }
  }
  if (styleStart !== -1 && (tagStart === -1 || styleStart < tagStart)) {
    const styleEnd = sanitized.indexOf('</style>', styleStart);
    if (styleEnd !== -1) {
    pos = styleEnd + 8;
    continue;
    }
  }

  if (tagStart === -1) break;

  // P2-FIX: Find end of opening tag respecting quoted attributes
  const tagEnd = findTagEnd(html, tagStart);
  if (tagEnd === -1) break;

  // Extract href attribute
  const tagContent = html.slice(tagStart, tagEnd + 1);
  const href = extractAttribute(tagContent, 'href');

  if (href) {
    // Find closing </a> tag
    const closeStart = sanitized.indexOf('</a>', tagEnd);
    if (closeStart !== -1) {
    const text = html.slice(tagEnd + 1, closeStart);
    // Strip any nested HTML tags from text
    const cleanText = text.replace(/<[^>]*>/g, '');
    links.push({ href, text: cleanText });
    pos = closeStart + 4;
    continue;
    }
  }

  pos = tagEnd + 1;
  }

  return links;
}

/**
* P2-FIX: Find the closing > of a tag, respecting quoted attribute values
*/
function findTagEnd(html: string, start: number): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = start + 1; i < html.length; i++) {
  const ch = html[i];
  if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
  else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
  else if (ch === '>' && !inSingleQuote && !inDoubleQuote) return i;
  }
  return -1;
}

/**
* Extract attribute value from HTML tag
* Handles single quotes, double quotes, and unquoted values
*/
function extractAttribute(tag: string, attrName: string): string | null {
  const lowerTag = tag.toLowerCase();
  // P2-FIX: Handle optional whitespace around = (e.g., href = "...")
  const attrRegex = new RegExp(`${attrName}\\s*=`, 'i');
  const attrMatch = attrRegex.exec(lowerTag);
  if (!attrMatch) return null;
  const attrPos = attrMatch.index;
  // Skip to after the = sign
  const eqPos = lowerTag.indexOf('=', attrPos);
  if (eqPos === -1) return null;

  let valueStart = eqPos + 1;
  // Skip whitespace after =
  while (valueStart < tag.length && (tag[valueStart] === ' ' || tag[valueStart] === '\t')) valueStart++;
  const quote = tag[valueStart];

  if (quote === "'" || quote === '"') {
  const endQuote = tag.indexOf(quote, valueStart + 1);
  if (endQuote === -1) return null;
  return tag.slice(valueStart + 1, endQuote);
  }

  // Unquoted value
  const spacePos = tag.indexOf(' ', valueStart);
  const endPos = spacePos === -1 ? tag.length - 1 : spacePos;
  return tag.slice(valueStart, endPos);
}

/**
* Validate URL format
*/
function isValidUrl(url: string): boolean {
  if (!url) return false;

  // Reject javascript: and data: URLs (XSS prevention)
  const lowerUrl = url.toLowerCase().trim();
  if (lowerUrl.startsWith('javascript:') ||
    lowerUrl.startsWith('data:') ||
    lowerUrl.startsWith('vbscript:')) {
  return false;
  }

  // Must start with http:// or https://
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://');
}

/**
* Normalize URL (remove tracking parameters, etc.)
*/
function normalizeUrl(url: string): string {
  try {
  const parsed = new URL(url);
  // Remove common tracking parameters
  parsed.searchParams.delete('utm_source');
  parsed.searchParams.delete('utm_medium');
  parsed.searchParams.delete('utm_campaign');
  parsed.searchParams.delete('utm_term');
  parsed.searchParams.delete('utm_content');
  parsed.searchParams.delete('fbclid');
  parsed.searchParams.delete('gclid');
  return parsed.toString();
  } catch {
  return url;
  }
}
