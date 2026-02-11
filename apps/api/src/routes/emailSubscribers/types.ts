import { z } from 'zod';

/**
* Types and Schemas for Email Subscribers
* P2-MEDIUM FIX: Extracted from emailSubscribers.ts God class
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
* Email subscriber creation schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const EmailSubscriberSchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  email: EmailSchema,
  consent_source: z.enum(['optin_form', 'manual_import', 'api']),
  consent_form_id: z.string().max(100).optional(),
  experiment_variant_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

/**
* Unsubscribe request schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const UnsubscribeSchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  email: EmailSchema,
}).strict();

/**
* Delete subscriber request schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const DeleteSubscriberSchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  email: EmailSchema,
}).strict();

/**
* Bulk subscribe request schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const BulkSubscribeSchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  subscribers: z.array(z.object({
    email: EmailSchema,
    consent_source: z.enum(['optin_form', 'manual_import', 'api']),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict()).min(1).max(100),
}).strict();

/**
* Subscriber query parameters schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const SubscriberQuerySchema = z.object({
  domain_id: z.string().uuid().optional(),
  status: z.enum(['active', 'unsubscribed', 'bounced', 'complained']).optional(),
  email: z.string().email().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

/**
* Subscriber ID params schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const SubscriberParamsSchema = z.object({
  id: z.string().uuid('Subscriber ID must be a valid UUID'),
}).strict();

/**
* Update subscriber request schema
* P2-MEDIUM FIX: Added .strict() for strict validation
*/
export const UpdateSubscriberSchema = z.object({
  status: z.enum(['active', 'unsubscribed', 'bounced', 'complained']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

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

/**
* Subscriber create input
*/
export interface SubscriberCreateInput {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  doubleOptIn?: boolean;
}

/**
* Subscriber update input
*/
export interface SubscriberUpdateInput {
  firstName?: string;
  lastName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  status?: 'active' | 'unsubscribed' | 'bounced' | 'complained';
}

/**
* Subscriber query parameters
*/
export interface SubscriberQueryParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'unsubscribed' | 'bounced' | 'complained' | 'all';
  tag?: string;
  search?: string;
  sortBy?: 'createdAt' | 'email' | 'lastActivity';
  sortOrder?: 'asc' | 'desc';
}
