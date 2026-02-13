/**
 * P2 TEST: FacebookAdapter - Social Media Publishing Tests
 *
 * Tests constructor validation, publish flow, rate limiting,
 * response validation, timeout handling, and health check.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FacebookAdapter } from '../FacebookAdapter';

// Mock config
vi.mock('@config', () => ({
  apiConfig: {
    baseUrls: { facebook: 'https://graph.facebook.com' },
    versions: { facebook: 'v18.0' },
  },
  timeoutConfig: {
    long: 30000,
    short: 5000,
  },
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
  isFacebookPostResponse: vi.fn((data: unknown) => {
    return data !== null && typeof data === 'object' && 'id' in (data as Record<string, unknown>);
  }),
}));

vi.mock('@kernel/retry', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetchModule from 'node-fetch';
const mockFetch = fetchModule as unknown as ReturnType<typeof vi.fn>;

describe('FacebookAdapter', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new FacebookAdapter('test-access-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '123_456', post_id: '456' }),
      text: async () => '',
      headers: { get: vi.fn().mockReturnValue(null) },
    });
  });

  describe('constructor', () => {
    it('should create instance with valid token', () => {
      expect(adapter).toBeInstanceOf(FacebookAdapter);
    });

    it('should throw for empty token', () => {
      expect(() => new FacebookAdapter('')).toThrow('non-empty string');
    });
  });

  describe('publishPagePost', () => {
    it('should publish post successfully', async () => {
      const result = await adapter.publishPagePost('page-123', 'Hello world!');
      expect(result.id).toBe('123_456');
      expect(result.post_id).toBe('456');
    });

    it('should call correct Facebook API endpoint', async () => {
      await adapter.publishPagePost('page-123', 'Test message');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/page-123/feed',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should include Bearer auth header', async () => {
      await adapter.publishPagePost('page-123', 'Test');
      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer test-access-token');
    });

    it('should throw for empty pageId', async () => {
      await expect(adapter.publishPagePost('', 'message')).rejects.toThrow('non-empty string');
    });

    it('should throw for empty message', async () => {
      await expect(adapter.publishPagePost('page-1', '')).rejects.toThrow('non-empty string');
    });

    it('should handle rate limiting (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'rate limited',
        headers: { get: vi.fn().mockReturnValue('60') },
      });
      await expect(adapter.publishPagePost('page-1', 'msg')).rejects.toThrow('rate limited');
    });

    it('should handle non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'server error',
        headers: { get: vi.fn().mockReturnValue(null) },
      });
      await expect(adapter.publishPagePost('page-1', 'msg')).rejects.toThrow('500');
    });

    it('should throw for invalid response format', async () => {
      // isFacebookPostResponse returns false for data without 'id'
      const { isFacebookPostResponse } = await import('@kernel/validation');
      (isFacebookPostResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'unexpected' }),
      });

      await expect(adapter.publishPagePost('page-1', 'msg')).rejects.toThrow('Invalid response format');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy for OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy for non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('503');
    });

    it('should return unhealthy on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Network timeout');
    });
  });
});
