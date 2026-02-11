/**
 * API Response Type Guards (extracted from apps/api/src/utils/validation.ts)
 * MEDIUM FIX E3: Fix error type mismatches
 */

/**
 * Type guard for AWeber error response
 * MEDIUM FIX E3: Fix error type mismatches
 */
export function isAWeberErrorResponse(data: unknown): data is { error?: { message: string; status: number }; message?: string } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (obj['error'] && typeof obj['error'] === 'object') {
    const error = obj['error'] as Record<string, unknown>;
    if (typeof error['message'] === 'string' && typeof error['status'] === 'number') {
      return true;
    }
  }
  if (typeof obj["message"] === 'string') return true;

  return false;
}

/**
 * Type guard for AWeber list response
 */
export function isAWeberListResponse(data: unknown): data is { id: string; name?: string; self_link?: string } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj["id"] === 'string';
}

/**
 * Type guard for ConstantContact errors response
 */
export function isConstantContactErrorsResponse(data: unknown): data is { errors?: Array<{ error_key?: string; error_message?: string }> } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!obj["errors"]) return false;
  if (!Array.isArray(obj["errors"])) return false;

  return obj["errors"].every((err: unknown) => {
    if (!err || typeof err !== 'object') return false;
    const error = err as Record<string, unknown>;
    return (error['error_key'] === undefined || typeof error['error_key'] === 'string') &&
        (error['error_message'] === undefined || typeof error['error_message'] === 'string');
  });
}

/**
 * Type guard for ConstantContact list response
 */
export function isConstantContactListResponse(data: unknown): data is { list_id?: string; name?: string; status?: string } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj["list_id"] === undefined || typeof obj["list_id"] === 'string';
}

/**
 * Type guard for Facebook error response
 * MEDIUM FIX E3: Fix error type mismatches
 */
export function isFacebookErrorResponse(data: unknown): data is { error?: { message: string; type: string; code: number; fbtrace_id?: string } } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!obj['error'] || typeof obj['error'] !== 'object') return false;
  const error = obj['error'] as Record<string, unknown>;

  return typeof error['message'] === 'string' &&
        typeof error['type'] === 'string' &&
        typeof error['code'] === 'number';
}

/**
 * Type guard for Facebook post response
 */
export function isFacebookPostResponse(data: unknown): data is { id: string; post_id?: string } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj["id"] === 'string';
}
