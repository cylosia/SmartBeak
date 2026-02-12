/**
 * Email platform validations
 * AWeber, ConstantContact, Mailchimp
 */

// ============================================================================
// AWeber Type Guards
// ============================================================================

export interface AWeberListResponse {
  id: string;
  name?: string;
  self_link?: string;
}

export interface AWeberErrorResponse {
  error?: {
    message: string;
    status: number;
  };
  message?: string;
}

/**
 * Type guard for AWeber error response
 */
export function isAWeberErrorResponse(data: unknown): data is AWeberErrorResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (obj['error'] && typeof obj['error'] === 'object') {
    const error = obj['error'] as Record<string, unknown>;
    if (typeof error['message'] === 'string' && typeof error['status'] === 'number') {
      return true;
    }
  }
  if (typeof obj['message'] === 'string') return true;

  return false;
}

/**
 * Type guard for AWeber list response
 */
export function isAWeberListResponse(data: unknown): data is AWeberListResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

// ============================================================================
// Constant Contact Type Guards
// ============================================================================

export interface ConstantContactListResponse {
  list_id: string;
  name?: string;
  status?: 'ACTIVE' | 'DEPRECATED';
}

export interface ConstantContactErrorResponse {
  error_key?: string;
  error_message?: string;
}

export interface ConstantContactErrorsResponse {
  errors?: ConstantContactErrorResponse[];
}

/**
 * Type guard for ConstantContact errors response
 */
export function isConstantContactErrorsResponse(data: unknown): data is ConstantContactErrorsResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!obj['errors']) return false;
  if (!Array.isArray(obj['errors'])) return false;

  return obj['errors'].every((err: unknown) => {
    if (!err || typeof err !== 'object') return false;
    const error = err as Record<string, unknown>;
    return (error['error_key'] === undefined || typeof error['error_key'] === 'string') &&
        (error['error_message'] === undefined || typeof error['error_message'] === 'string');
  });
}

/**
 * Type guard for ConstantContact list response
 */
// P1-TYPE FIX: Require list_id to be present AND a string.
// Previously any object without list_id passed (undefined === undefined is true).
export function isConstantContactListResponse(data: unknown): data is ConstantContactListResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['list_id'] === 'string';
}

// ============================================================================
// Mailchimp Type Guards
// ============================================================================

export interface MailchimpListResponse {
  id: string;
  name?: string;
  status?: string;
}

export interface MailchimpMemberResponse {
  id?: string;
  email_address?: string;
  status?: string;
}

/**
 * Type guard for Mailchimp list response
 */
export function isMailchimpListResponse(data: unknown): data is MailchimpListResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

/**
 * Type guard for Mailchimp member response
 */
export function isMailchimpMemberResponse(data: unknown): data is MailchimpMemberResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string' || typeof obj['email_address'] === 'string';
}
