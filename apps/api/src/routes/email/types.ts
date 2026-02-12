import { z } from 'zod';

/**
* Types and Schemas for Email Routes
* P2-MEDIUM FIX: Extracted from email.ts God class
*/


/**
* Email validation schema
* P2-MEDIUM FIX: Strict Zod schema with format validation
*/
export const EmailSchema = z.string()
  .email('Invalid email format')
  .max(255)
  .toLowerCase()
  .trim();

/**
* Allowed fields for lead magnets (input)
*/
export const ALLOWED_LEAD_MAGNET_FIELDS = ['name', 'content', 'settings', 'domain_id'] as const;

/**
* Allowed fields for sequences (input)
*/
export const ALLOWED_SEQUENCE_FIELDS = ['name', 'steps', 'settings', 'domain_id'] as const;

/**
* Allowed fields for forms (input)
*/
export const ALLOWED_FORM_FIELDS = ['name', 'form_config', 'settings', 'domain_id'] as const;

/**
* SECURITY FIX: Response field whitelists to prevent over-exposure of raw DB rows.
* Previously returning('*') sent all columns including internal metadata.
*/
export const RESPONSE_LEAD_MAGNET_FIELDS = ['id', 'name', 'content', 'settings', 'domain_id', 'created_at'] as const;
export const RESPONSE_SEQUENCE_FIELDS = ['id', 'name', 'steps', 'settings', 'domain_id', 'created_at'] as const;
export const RESPONSE_FORM_FIELDS = ['id', 'name', 'form_config', 'settings', 'domain_id', 'created_at'] as const;

/**
* Lead magnet creation schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const LeadMagnetSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  content: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

/**
* Email sequence schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const SequenceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  steps: z.array(z.object({
    order: z.number().int().min(0),
    delay_hours: z.number().int().min(0).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().max(50000).optional(),
  }).strict()).max(50).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

/**
* Opt-in form schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const FormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  form_config: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

/**
* Email send request schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const EmailSendSchema = z.object({
  to: z.union([
    z.array(EmailSchema).min(1).max(100)
  ]),
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body is required').max(100000),
  from: EmailSchema.optional(),
  reply_to: EmailSchema.optional(),
  cc: z.array(EmailSchema).max(100).optional(),
  bcc: z.array(EmailSchema).max(100).optional(),
}).strict();

/**
* ID params schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const IdParamsSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
}).strict();

/**
* Email query schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const EmailQuerySchema = z.object({
  domain_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'sent', 'scheduled', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

/**
* Auth context type
*/
export interface AuthContext {
  userId: string;
  orgId: string;
}

/**
* Fastify request-like type for auth verification
*/
export interface FastifyRequestLike {
  headers: {
    authorization?: string | undefined;
  };
}

/**
* Audit event parameters
*/
export interface AuditEventParams {
  orgId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip: string;
}
