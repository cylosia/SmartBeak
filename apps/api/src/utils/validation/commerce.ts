/**
 * E-commerce validations
 * Shopify, WooCommerce, BigCommerce
 */

// ============================================================================
// Shopify Type Guards
// ============================================================================

export interface ShopifyProductResponse {
  id: number | string;
  title?: string;
  handle?: string;
  status?: 'active' | 'archived' | 'draft';
}

/**
 * Type guard for Shopify product response
 */
export function isShopifyProductResponse(data: unknown): data is ShopifyProductResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'number' || typeof obj['id'] === 'string';
}

// ============================================================================
// WooCommerce Type Guards
// ============================================================================

export interface WooCommerceProductResponse {
  id: number;
  name?: string;
  slug?: string;
  status?: 'publish' | 'future' | 'draft' | 'pending' | 'private' | 'trash';
}

/**
 * Type guard for WooCommerce product response
 */
export function isWooCommerceProductResponse(data: unknown): data is WooCommerceProductResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'number';
}

// ============================================================================
// BigCommerce Type Guards
// ============================================================================

export interface BigCommerceProductResponse {
  id: number;
  name?: string;
  sku?: string;
  is_visible?: boolean;
}

/**
 * Type guard for BigCommerce product response
 */
export function isBigCommerceProductResponse(data: unknown): data is BigCommerceProductResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'number';
}
