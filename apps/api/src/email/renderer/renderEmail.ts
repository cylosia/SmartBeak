import { getLogger } from '../../../../../packages/kernel/logger';

/**
* Email block types
*/

const logger = getLogger('EmailRenderer');
type EmailBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; src: string; alt: string; link?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'divider' };

/**
* Email message structure for rendering
*/
export interface EmailMessage {
  blocks: EmailBlock[];
  footer: {
    compliance_copy: string;
    physical_address: string;
    unsubscribe_link: string;
  };
}

/**
* Sanitize and validate URL for safe use in HTML attributes
* Only allows http, https, mailto, and tel protocols
*/
function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';

  try {
  const parsed = new URL(url);
  const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];

  if (!allowedProtocols.includes(parsed.protocol)) {
    logger.warn(`Blocked unsafe URL protocol: ${parsed.protocol}`);
    return '#';
  }

  return url;
  } catch {
  // If URL parsing fails, check if it's a relative path (starts with /)
  if (url.startsWith('/') && !url.startsWith('//')) {
    return url;
  }
  logger.warn(`Blocked invalid URL: ${url}`);
  return '#';
  }
}

const style: Record<string, string> = {
  'h1': 'font-size:22px;margin:16px 0;',
  'h2': 'font-size:18px;margin:14px 0;',
  'h3': 'font-size:16px;margin:12px 0;',
  'p': 'font-size:14px;line-height:1.6;margin:10px 0;',
  'btn': 'display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;',
  'hr': 'border:none;border-top:1px solid #e5e7eb;margin:16px 0;',
  'img': 'max-width:100%;height:auto;'
};

export function renderEmailHTML(message: EmailMessage): string {
  const blocksHtml = message.blocks.map((b: EmailBlock) => {
  switch (b.type) {
    case 'heading': {
    const headingStyle = b.level === 1 ? style['h1'] : b.level === 2 ? style['h2'] : style['h3'];
    return `<h${b.level} style="${headingStyle}">${escape(b.text)}</h${b.level}>`;
    }
    case 'paragraph':
    return `<p style='${style['p']}'>${escape(b.text)}</p>`;
    case 'image': {
    const img = `<img src='${escape(sanitizeUrl(b.src))}' alt='${escape(b.alt)}' style='${style['img']}'/>`;
    return b.link ? `<a href='${escape(sanitizeUrl(b.link))}'>${img}</a>` : img;
    }
    case 'button':
    return `<a href='${escape(sanitizeUrl(b['url']))}' style='${style['btn']}'>${escape(b.text)}</a>`;
    case 'divider':
    return `<hr style='${style['hr']}'/>`;
  }
  }).join('');

  const footer = `
  <hr style='${style['hr']}'/>
  <p style='font-size:12px;color:#6b7280;'>
    ${escape(message.footer.compliance_copy)}<br/>
    ${escape(message.footer.physical_address)}<br/>
    <a href='${escape(sanitizeUrl(message.footer.unsubscribe_link))}'>Unsubscribe</a>
  </p>
  `;

  return `<div>${blocksHtml}${footer}</div>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/\//g, '&#x2F;');
}
