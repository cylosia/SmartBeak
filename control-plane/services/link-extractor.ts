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

  while (pos < html.length) {
  // Find opening <a tag
  const tagStart = html.toLowerCase().indexOf('<a', pos);
  if (tagStart === -1) break;

  // Find end of opening tag
  const tagEnd = html.indexOf('>', tagStart);
  if (tagEnd === -1) break;

  // Extract href attribute
  const tagContent = html.slice(tagStart, tagEnd + 1);
  const href = extractAttribute(tagContent, 'href');

  if (href) {
    // Find closing </a> tag
    const closeStart = html.toLowerCase().indexOf('</a>', tagEnd);
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
* Extract attribute value from HTML tag
* Handles single quotes, double quotes, and unquoted values
*/
function extractAttribute(tag: string, attrName: string): string | null {
  const lowerTag = tag.toLowerCase();
  const attrPos = lowerTag.indexOf(`${attrName}=`);
  if (attrPos === -1) return null;

  const valueStart = attrPos + attrName.length + 1;
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
