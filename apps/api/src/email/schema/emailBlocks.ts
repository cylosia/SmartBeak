import { z } from 'zod';

// P2-SECURITY FIX: Add Zod runtime validation schemas alongside TypeScript types.
// Previously only TypeScript types existed with no runtime validation.
// Fields like `src`, `url`, `link` now reject `javascript:` URIs.

// P0-SECURITY FIX: The previous SafeUrlSchema only blocked `javascript:` URIs.
// `data:`, `vbscript:`, and `blob:` URIs can also execute scripts or bypass
// CSP in certain browser contexts. All non-HTTP(S) URI schemes are now rejected.
const ALLOWED_URL_SCHEMES = ['https:', 'http:'];

const SafeUrlSchema = z.string().url().max(2048).refine(
  (u) => {
    try {
      const parsed = new URL(u);
      return ALLOWED_URL_SCHEMES.includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  { message: 'Only http: and https: URLs are allowed' }
);

// P0-SECURITY FIX: Unsubscribe links must use HTTPS to prevent downgrade attacks
// and to protect subscriber privacy. CAN-SPAM compliance also requires working links.
const SafeHttpsUrlSchema = z.string().url().max(2048).refine(
  (u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'Unsubscribe links must use HTTPS' }
);

export const EmailBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: z.string().max(500) }).strict(),
  z.object({ type: z.literal('paragraph'), text: z.string().max(10000) }).strict(),
  z.object({ type: z.literal('image'), src: SafeUrlSchema, alt: z.string().max(500), link: SafeUrlSchema.optional() }).strict(),
  z.object({ type: z.literal('button'), text: z.string().max(200), url: SafeUrlSchema }).strict(),
  z.object({ type: z.literal('divider') }).strict(),
]);

export type EmailBlock = z.infer<typeof EmailBlockSchema>;

export const ComplianceFooterSchema = z.object({
  physical_address: z.string().min(1).max(500),
  // P0-SECURITY FIX: Use SafeHttpsUrlSchema — unsubscribe links must be HTTPS.
  unsubscribe_link: SafeHttpsUrlSchema,
  compliance_copy: z.string().min(1).max(2000),
}).strict();

export type ComplianceFooter = z.infer<typeof ComplianceFooterSchema>;

export const EmailMessageSchema = z.object({
  id: z.string().uuid(),
  // P0-SECURITY FIX: Strip CRLF characters from subject to prevent header injection.
  // An attacker supplying "\r\nBcc: victim@example.com" in the subject would inject
  // additional SMTP headers and send copies to arbitrary recipients.
  subject: z.string().min(1).max(998).transform(s => s.replace(/[\r\n]/g, '')),
  preview_text: z.string().max(200).optional(),
  blocks: z.array(EmailBlockSchema).max(100),
  footer: ComplianceFooterSchema,
}).strict();

export type EmailMessage = z.infer<typeof EmailMessageSchema>;
