/**
 * P0 TEST: WebPublishingAdapter - Webhook Publishing Tests
 *
 * Tests config validation, SSRF protection, auth header construction,
 * request lifecycle, and error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import {
  WebPublishingAdapter,
  FetchTimeoutError,
  registerRequestController,
  unregisterRequestController,
  cancelRequest,
  cancelAllRequests,
  stopControllerCleanup,
} from '../WebPublishingAdapter';
import type { PublishingContent, PublishingTarget } from '../PublishingAdapter';

// Mock SSRF validation (both sync validateUrl used in validateConfig and
// async validateUrlWithDns used in publish())
vi.mock('@security/ssrf', () => ({
  validateUrl: vi.fn((url: string, _opts?: Record<string, unknown>) => {
    if (url.includes('internal') || url.includes('127.0.0.1')) {
      return { allowed: false, reason: 'Internal IP addresses not allowed' };
    }
    if (!url.startsWith('https://')) {
      return { allowed: false, reason: 'HTTPS required' };
    }
    return { allowed: true, sanitizedUrl: url };
  }),
  // P1-SSRF FIX: publish() now uses validateUrlWithDns (async, DNS-resolving).
  validateUrlWithDns: vi.fn(async (url: string, _opts?: Record<string, unknown>) => {
    if (url.includes('internal') || url.includes('127.0.0.1')) {
      return { allowed: false, reason: 'Internal IP addresses not allowed' };
    }
    if (!url.startsWith('https://')) {
      return { allowed: false, reason: 'HTTPS required' };
    }
    return { allowed: true, sanitizedUrl: url };
  }),
}));

describe('WebPublishingAdapter', () => {
  let adapter: WebPublishingAdapter;

  const validContent: PublishingContent = {
    title: 'Test Post',
    body: '<p>Hello world</p>',
    excerpt: 'Hello',
    tags: ['test'],
    categories: ['blog'],
  };

  const validTarget: PublishingTarget = {
    id: 'target-1',
    type: 'webhook',
    name: 'Test Webhook',
    config: {
      url: 'https://api.example.com/webhook',
      method: 'POST',
    },
  };

  beforeEach(() => {
    adapter = new WebPublishingAdapter();
    vi.clearAllMocks();
    // Mock global fetch — must include headers and text() because publish()
    // now checks Content-Length via response.headers.get() and reads via response.text()
    // before parsing (P1-RESPONSE-SIZE FIX).
    const responseBody = JSON.stringify({ id: 'pub-123', url: 'https://example.com/post/123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue(null) },
      text: async () => responseBody,
      json: async () => ({ id: 'pub-123', url: 'https://example.com/post/123' }),
    });
  });

  afterAll(() => {
    // P2-1 FIX: Stop the module-level cleanup interval to prevent timer leaks
    // in the Vitest test runner.
    stopControllerCleanup();
  });

  afterEach(() => {
    cancelAllRequests();
    vi.restoreAllMocks();
  });

  describe('validateConfig', () => {
    it('should accept valid HTTPS webhook config', () => {
      const result = adapter.validateConfig({ url: 'https://api.example.com/hook' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing URL', () => {
      const result = adapter.validateConfig({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL is required');
    });

    it('should reject non-string URL', () => {
      const result = adapter.validateConfig({ url: 123 });
      expect(result.valid).toBe(false);
    });

    it('should reject internal URLs via SSRF check', () => {
      const result = adapter.validateConfig({ url: 'https://127.0.0.1/hook' });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid HTTP methods', () => {
      const result = adapter.validateConfig({ url: 'https://api.example.com/hook', method: 'DELETE' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Method must be POST, PUT, or PATCH');
    });

    it('should accept POST, PUT, PATCH methods', () => {
      for (const method of ['POST', 'PUT', 'PATCH']) {
        const result = adapter.validateConfig({ url: 'https://api.example.com/hook', method });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('publish', () => {
    it('should publish content successfully', async () => {
      const result = await adapter.publish(validContent, validTarget);
      expect(result.success).toBe(true);
      expect(result.publishedId).toBe('pub-123');
      expect(result.publishedUrl).toBe('https://example.com/post/123');
    });

    it('should include correct payload in request', async () => {
      await adapter.publish(validContent, validTarget);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"title":"Test Post"'),
        }),
      );
    });

    it('should return failure for invalid config', async () => {
      const badTarget: PublishingTarget = {
        ...validTarget,
        config: { url: '' },
      };
      const result = await adapter.publish(validContent, badTarget);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid configuration');
    });

    it('should handle bearer auth', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'bearer', token: 'my-token' },
        },
      };
      await adapter.publish(validContent, target);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer my-token');
    });

    it('should handle basic auth', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'basic', username: 'user', password: 'pass' },
        },
      };
      await adapter.publish(validContent, target);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const expected = Buffer.from('user:pass').toString('base64');
      expect(fetchCall[1].headers['Authorization']).toBe(`Basic ${expected}`);
    });

    it('should reject basic auth without credentials', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'basic' },
        },
      };
      const result = await adapter.publish(validContent, target);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Basic auth requires both username and password');
    });

    it('should handle api-key auth with allowed header', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'api-key', keyHeader: 'x-api-key', token: 'key-123' },
        },
      };
      await adapter.publish(validContent, target);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers['x-api-key']).toBe('key-123');
    });

    it('should reject api-key auth when keyHeader is missing (P0-3b: silent auth bypass)', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'api-key', token: 'key-123' }, // keyHeader missing
        },
      };
      const result = await adapter.publish(validContent, target);
      expect(result.success).toBe(false);
      expect(result.error).toContain('api-key auth requires both keyHeader and token');
      // Confirm no outbound request was made without auth
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject api-key auth when token is missing (P0-3b: silent auth bypass)', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'api-key', keyHeader: 'x-api-key' }, // token missing
        },
      };
      const result = await adapter.publish(validContent, target);
      expect(result.success).toBe(false);
      expect(result.error).toContain('api-key auth requires both keyHeader and token');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject api-key auth with disallowed header (header injection)', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'api-key', keyHeader: 'Authorization', token: 'injected' },
        },
      };
      const result = await adapter.publish(validContent, target);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid api-key header name');
    });

    it('should reject unknown auth type', async () => {
      const target: PublishingTarget = {
        ...validTarget,
        config: {
          url: 'https://api.example.com/webhook',
          auth: { type: 'oauth' },
        },
      };
      const result = await adapter.publish(validContent, target);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown auth type');
    });

    it('should handle non-OK response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      const result = await adapter.publish(validContent, validTarget);
      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should handle fetch timeout (AbortError)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );
      const result = await adapter.publish(validContent, validTarget);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should handle network errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      const result = await adapter.publish(validContent, validTarget);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('request controller management', () => {
    it('should register and cancel a request', () => {
      const controller = new AbortController();
      registerRequestController('req-1', controller);
      expect(cancelRequest('req-1')).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('should return false when cancelling non-existent request', () => {
      expect(cancelRequest('nonexistent')).toBe(false);
    });

    it('should cancel all requests', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      registerRequestController('r1', c1);
      registerRequestController('r2', c2);
      const count = cancelAllRequests();
      expect(count).toBe(2);
      expect(c1.signal.aborted).toBe(true);
      expect(c2.signal.aborted).toBe(true);
    });

    it('should unregister a controller', () => {
      const controller = new AbortController();
      registerRequestController('req-2', controller);
      unregisterRequestController('req-2');
      expect(cancelRequest('req-2')).toBe(false);
    });
  });

  describe('FetchTimeoutError', () => {
    it('should have correct name and message', () => {
      const err = new FetchTimeoutError('timed out');
      expect(err.name).toBe('FetchTimeoutError');
      expect(err.message).toBe('timed out');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
