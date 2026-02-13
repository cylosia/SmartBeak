/**
 * P2 TEST: AmazonAdapter - Affiliate Integration Tests
 *
 * Tests constructor validation, product search, response parsing,
 * affiliate link generation, rate limiting, and health check.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AmazonAdapter } from '../amazon';
import type { AmazonCredentials } from '../amazon';

// Mock config
vi.mock('@config', () => ({
  timeoutConfig: { long: 30000, short: 5000 },
}));

// Mock kernel utilities
vi.mock('@kernel/request', () => ({
  StructuredLogger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  createRequestContext: vi.fn().mockReturnValue({ id: 'test-ctx' }),
  MetricsCollector: vi.fn().mockImplementation(() => ({
    recordLatency: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
  })),
}));

vi.mock('@kernel/validation', () => ({
  validateNonEmptyString: vi.fn((val: string, name: string) => {
    if (!val || typeof val !== 'string' || val.trim() === '') {
      throw new Error(`${name} must be a non-empty string`);
    }
  }),
}));

vi.mock('@kernel/retry', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('abort-controller', () => ({
  AbortController: globalThis.AbortController,
}));

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetchModule from 'node-fetch';
const mockFetch = fetchModule as unknown as ReturnType<typeof vi.fn>;

const validCredentials: AmazonCredentials = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  associateTag: 'test-tag-20',
  marketplace: 'US',
};

describe('AmazonAdapter', () => {
  let adapter: AmazonAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AmazonAdapter(validCredentials);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        SearchResult: {
          Items: [
            {
              ASIN: 'B08N5WRWNW',
              DetailPageURL: 'https://www.amazon.com/dp/B08N5WRWNW',
              ItemInfo: { Title: { DisplayValue: 'Test Product' } },
              Images: { Primary: { Large: { URL: 'https://images.amazon.com/test.jpg' } } },
              Offers: { Listings: [{ Price: { Amount: 29.99, Currency: 'USD' } }] },
            },
          ],
        },
      }),
      headers: { get: vi.fn().mockReturnValue(null) },
    });
  });

  describe('constructor', () => {
    it('should create instance with valid credentials', () => {
      expect(adapter).toBeInstanceOf(AmazonAdapter);
      expect(adapter.provider).toBe('amazon');
    });

    it('should throw without access key', () => {
      expect(() => new AmazonAdapter({ ...validCredentials, accessKey: '' })).toThrow('ACCESS_KEY');
    });

    it('should throw without secret key', () => {
      expect(() => new AmazonAdapter({ ...validCredentials, secretKey: '' })).toThrow('SECRET_KEY');
    });

    it('should throw without associate tag', () => {
      expect(() => new AmazonAdapter({ ...validCredentials, associateTag: '' })).toThrow('ASSOCIATE_TAG');
    });
  });

  describe('searchProducts', () => {
    it('should return products from valid API response', async () => {
      const products = await adapter.searchProducts('laptop');
      expect(products).toHaveLength(1);
      expect(products[0].asin).toBe('B08N5WRWNW');
      expect(products[0].title).toBe('Test Product');
      expect(products[0].price).toBe(29.99);
      expect(products[0].currency).toBe('USD');
      expect(products[0].imageUrl).toBe('https://images.amazon.com/test.jpg');
    });

    it('should throw for empty keywords', async () => {
      await expect(adapter.searchProducts('')).rejects.toThrow('non-empty string');
    });

    it('should handle empty search results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ SearchResult: { Items: [] } }),
      });
      const products = await adapter.searchProducts('nonexistent-product-xyz');
      expect(products).toHaveLength(0);
    });

    it('should handle malformed items gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          SearchResult: {
            Items: [
              { ASIN: 'valid', DetailPageURL: 'https://amazon.com/dp/valid' },
              { invalid: true }, // Missing ASIN
              null, // Null item
            ],
          },
        }),
      });
      const products = await adapter.searchProducts('test');
      expect(products).toHaveLength(1); // Only the valid item
    });

    it('should handle rate limiting (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: vi.fn().mockReturnValue('30') },
      });
      await expect(adapter.searchProducts('test')).rejects.toThrow('rate limited');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      await expect(adapter.searchProducts('test')).rejects.toThrow('503');
    });
  });

  describe('generateAffiliateLink', () => {
    it('should generate link with default tag', () => {
      const link = adapter.generateAffiliateLink('B08N5WRWNW');
      expect(link).toBe('https://www.amazon.com/dp/B08N5WRWNW?tag=test-tag-20');
    });

    it('should generate link with custom tag', () => {
      const link = adapter.generateAffiliateLink('B08N5WRWNW', 'custom-tag-20');
      expect(link).toBe('https://www.amazon.com/dp/B08N5WRWNW?tag=custom-tag-20');
    });
  });

  describe('fetchReports', () => {
    it('should return empty array (not implemented)', async () => {
      const reports = await adapter.fetchReports({
        startDate: new Date(),
        endDate: new Date(),
        credentialsRef: 'ref-1',
      });
      expect(reports).toEqual([]);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when API responds', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should treat auth errors as reachable (healthy)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });
});
