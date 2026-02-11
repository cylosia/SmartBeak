/**
* Canary type definitions for type-safe adapter health checks
*
* This module provides TypeScript interfaces and types for implementing
* adapter health checks (canaries) across different service integrations.
*
* @module canaries/types
*/

/**
* Interface for canary adapters
* Implement this interface to create adapter-specific health checks
* @example
* ```typescript
* class MyAdapter implements CanaryAdapter {
*   async healthCheck() {
*     return { healthy: true, latency: 100 };
*   }
* }
* ```
*/
export interface CanaryAdapter {
  healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }>;
}

/**
* Result of a canary check
*/
export interface CanaryResult {
  name: string;
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
* YouTube-specific adapter interface
*/
export interface YouTubeAdapter extends CanaryAdapter {
  // YouTube-specific methods can be added here
}

/**
* Vercel-specific adapter interface
*/
export interface VercelAdapter extends CanaryAdapter {
  // Vercel-specific methods can be added here
}

/**
* Google Analytics adapter interface
*/
export interface GoogleAnalyticsAdapter extends CanaryAdapter {
  fetchMetrics(siteId: string, options: { dimensions: string[]; metrics: string[] }): Promise<unknown>;
}

/**
* Google Search Console adapter interface
*/
export interface GoogleSearchConsoleAdapter extends CanaryAdapter {
  fetchSearchAnalytics(siteUrl: string, options: Record<string, unknown>): Promise<unknown>;
}

/**
* Instagram-specific adapter interface
*/
export interface InstagramAdapter extends CanaryAdapter {
  // Instagram-specific methods can be added here
}

/**
* Pinterest-specific adapter interface
*/
export interface PinterestAdapter extends CanaryAdapter {
  // Pinterest-specific methods can be added here
}

/**
* Facebook-specific adapter interface
*/
export interface FacebookAdapter extends CanaryAdapter {
  // Facebook-specific methods can be added here
}
