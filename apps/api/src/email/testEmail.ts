import { renderEmailHTML } from './renderer/renderEmail';
import { EmailMessage } from './schema/emailBlocks';

/**
* Send a test email
* @param provider - Email provider type
* @param to - Recipient email address
* @param message - Email message content
* @returns Test email result
*/
// P1-7 FIX: Return 'rendered' instead of 'sent' since this only renders HTML
// and does NOT actually send an email. Callers must not assume delivery occurred.
export async function sendTestEmail(
  provider: 'smtp' | 'external',
  to: string,
  message: EmailMessage
): Promise<{ rendered: boolean; to: string; html_preview: string }> {
  const html = renderEmailHTML(message);
  // Renders email HTML for preview — actual SMTP delivery is NOT implemented
  return { rendered: true, to, html_preview: html };
}

export type InboxTestResult = {
  provider: string;
  placement: 'inbox' | 'promotions' | 'spam';
  notes?: string;
  timestamp: string;
};
