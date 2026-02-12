import { renderEmailHTML } from './renderer/renderEmail';
import { EmailMessage } from './schema/emailBlocks';

/**
* Send a test email
* @param provider - Email provider type
* @param to - Recipient email address
* @param message - Email message content
* @returns Test email result
*/
export async function sendTestEmail(
  provider: 'smtp' | 'external',
  to: string,
  message: EmailMessage
): Promise<{ sent: boolean; to: string; html_preview: string }> {
  const html = renderEmailHTML(message);
  // Send via configured test SMTP or export HTML for external tools
  // P1-7 FIX: This function only renders HTML, it does not actually send email
  return { sent: false, to, html_preview: html };
}

export type InboxTestResult = {
  provider: string;
  placement: 'inbox' | 'promotions' | 'spam';
  notes?: string;
  timestamp: string;
};
