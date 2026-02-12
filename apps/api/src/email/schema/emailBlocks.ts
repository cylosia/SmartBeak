import { z } from 'zod';

// P2-SECURITY FIX: Add Zod runtime validation schemas alongside TypeScript types.
// Previously only TypeScript types existed with no runtime validation.
// Fields like `src`, `url`, `link` now reject `javascript:` URIs.

const SafeUrlSchema = z.string().url().max(2048).refine(
  (u) => !u.toLowerCase().startsWith('javascript:'),
  { message: 'javascript: URIs are not allowed' }
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
  unsubscribe_link: SafeUrlSchema,
  compliance_copy: z.string().min(1).max(2000),
}).strict();

export type ComplianceFooter = z.infer<typeof ComplianceFooterSchema>;

export const EmailMessageSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1).max(998),
  preview_text: z.string().max(200).optional(),
  blocks: z.array(EmailBlockSchema).max(100),
  footer: ComplianceFooterSchema,
}).strict();

export type EmailMessage = z.infer<typeof EmailMessageSchema>;
