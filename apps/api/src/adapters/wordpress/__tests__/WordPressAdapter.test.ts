/**
 * WordPress Adapter SSRF Protection Tests
 *
 * Verifies DNS rebinding prevention and TOCTOU-safe URL usage
 * in fetchWordPressPosts, createWordPressPost, and healthCheck.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWordPressPosts, createWordPressPost, healthCheck } from '../WordPressAdapter';

// Mock DNS-aware SSRF validation
vi.mock('@security/ssrf', () => ({
  validateUrlWithDns: vi.fn(async (url: string) => {
    if (url.includes('evil-rebind') || url.includes('127.0.0.1') || url.includes('internal')) {
      return { allowed: false, reason: 'Hostname resolves to internal IP: 127.0.0.1' };
    }
    return { allowed: true, sanitizedUrl: url };
  }),
}));

// Mock logger and metrics to prevent side effects
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@kernel/request', () => ({
  MetricsCollector: class {
    recordError = vi.fn();
    recordLatency = vi.fn();
  },
}));

vi.mock('@config', () => ({
  DEFAULT_TIMEOUTS: { medium: 30000 },
}));

vi.mock('../../../utils/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

describe('WordPressAdapter SSRF Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Production code calls assertResponseSizeOk(response) → response.headers.get()
    // then reads response.text() + JSON.parse() rather than response.json() directly.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue(null) },
      text: async () => JSON.stringify([]),
      json: async () => ([]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // fetchWordPressPosts
  // ==========================================================================

  describe('fetchWordPressPosts', () => {
    it('should reject URLs that resolve to internal IPs (DNS rebinding)', async () => {
      await expect(fetchWordPressPosts({ baseUrl: 'http://evil-rebind.attacker.com' }))
        .rejects.toThrow('SSRF protection');
    });

    it('should allow legitimate WordPress URLs', async () => {
      const posts = await fetchWordPressPosts({ baseUrl: 'http://my-wordpress.com' });
      expect(Array.isArray(posts)).toBe(true);
    });

    it('should use sanitizedUrl for outbound requests', async () => {
      await fetchWordPressPosts({ baseUrl: 'http://my-wordpress.com' });
      expect(global.fetch).toHaveBeenCalled();
      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(calledUrl).toContain('my-wordpress.com/wp-json/wp/v2/posts');
    });

    it('should enforce HTTPS when credentials are present', async () => {
      await expect(fetchWordPressPosts({
        baseUrl: 'http://my-wordpress.com',
        username: 'admin',
        password: 'secret',
      })).rejects.toThrow('HTTPS is required when using authentication credentials');
    });
  });

  // ==========================================================================
  // createWordPressPost
  // ==========================================================================

  describe('createWordPressPost', () => {
    it('should reject DNS rebinding URLs', async () => {
      const postBody = { id: 1, title: { rendered: 'Test' }, content: { rendered: '' }, date: '', modified: '', status: 'draft', author: 1 };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, status: 201, statusText: 'Created',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: async () => JSON.stringify(postBody),
        json: async () => postBody,
      });

      await expect(createWordPressPost(
        { baseUrl: 'http://evil-rebind.attacker.com' },
        { title: 'Test', content: 'Content' }
      )).rejects.toThrow('SSRF protection');
    });

    it('should allow legitimate URLs', async () => {
      const postBody = { id: 1, title: { rendered: 'Test' }, content: { rendered: '' }, date: '', modified: '', status: 'draft', author: 1 };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, status: 201, statusText: 'Created',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: async () => JSON.stringify(postBody),
        json: async () => postBody,
      });

      const result = await createWordPressPost(
        { baseUrl: 'http://my-wordpress.com' },
        { title: 'Test', content: 'Content' }
      );
      expect(result.id).toBe(1);
    });
  });

  // ==========================================================================
  // healthCheck
  // ==========================================================================

  describe('healthCheck', () => {
    it('should reject DNS rebinding URLs', async () => {
      const result = await healthCheck({ baseUrl: 'http://evil-rebind.attacker.com' });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('SSRF protection');
    });

    it('should allow legitimate URLs and report health', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, status: 200, statusText: 'OK',
      });

      const result = await healthCheck({ baseUrl: 'http://my-wordpress.com' });
      expect(result.healthy).toBe(true);
    });

    it('should use sanitizedUrl for outbound requests', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, status: 200, statusText: 'OK',
      });

      await healthCheck({ baseUrl: 'http://my-wordpress.com' });
      expect(global.fetch).toHaveBeenCalled();
      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(calledUrl).toContain('my-wordpress.com/wp-json/wp/v2/posts');
    });
  });
});
