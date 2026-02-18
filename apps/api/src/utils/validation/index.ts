/**
 * Validation utilities - Re-exports
 * 
 * This module provides validation utilities organized by category:
 * - types: Shared validation types and error classes
 * - core: Core validation functions (strings, URLs, arrays)
 * - adapter: Adapter credential validations
 * - email: Email platform validations (AWeber, ConstantContact, Mailchimp)
 * - social: Social platform validations (Facebook, Instagram, LinkedIn, Pinterest, TikTok, YouTube)
 * - video: Video platform validations (Vimeo, SoundCloud)
 * - commerce: E-commerce validations (Shopify, WooCommerce, BigCommerce)
 */

// ============================================================================
// Core Exports
// ============================================================================

export {
  z,
  handleZodError,
  parseWithSchema,
  safeParseWithSchema,
  validateNonEmptyString,
  validateUrl,
  validateArray,
  whitelistFields,
} from './core';

// ============================================================================
// Types Exports
// ============================================================================

export {
  ValidationError,
  type ValidationErrorResponse,
  type ArrayValidationOptions,
} from './types';

// ============================================================================
// Adapter Exports
// ============================================================================

export {
  validateGACreds,
  validateGSCCreds,
  validateFacebookCreds,
  validateVercelCreds,
} from './adapter';

// ============================================================================
// Email Platform Exports
// ============================================================================

export {
  // AWeber
  type AWeberListResponse,
  type AWeberErrorResponse,
  isAWeberErrorResponse,
  isAWeberListResponse,
  // Constant Contact
  type ConstantContactListResponse,
  type ConstantContactErrorResponse,
  type ConstantContactErrorsResponse,
  isConstantContactErrorsResponse,
  isConstantContactListResponse,
  // Mailchimp
  type MailchimpListResponse,
  type MailchimpMemberResponse,
  isMailchimpListResponse,
  isMailchimpMemberResponse,
} from './email';

// ============================================================================
// Social Platform Exports
// ============================================================================

export {
  // Facebook
  type FacebookPostResponse,
  type FacebookErrorResponse,
  isFacebookErrorResponse,
  isFacebookPostResponse,
  // Instagram
  type InstagramPostResponse,
  isInstagramPostResponse,
  // LinkedIn
  type LinkedInPostResponse,
  isLinkedInPostResponse,
  // Pinterest
  type PinterestPostResponse,
  isPinterestPostResponse,
  // TikTok
  type TikTokPostResponse,
  isTikTokPostResponse,
  // YouTube
  type YouTubeVideoSnippet,
  type YouTubeVideoStatus,
  type YouTubeVideoResponse,
  isYouTubeVideoResponse,
} from './social';

// ============================================================================
// Video Platform Exports
// ============================================================================

export {
  // Vimeo
  type VimeoVideoMetadata,
  type VimeoVideoResponse,
  isVimeoVideoResponse,
  // SoundCloud
  type SoundCloudTrackResponse,
  isSoundCloudTrackResponse,
} from './video';

// ============================================================================
// E-commerce Exports
// ============================================================================

export {
  // Shopify
  type ShopifyProductResponse,
  isShopifyProductResponse,
  // WooCommerce
  type WooCommerceProductResponse,
  isWooCommerceProductResponse,
  // BigCommerce
  type BigCommerceProductResponse,
  isBigCommerceProductResponse,
} from './commerce';
