/**
 * P2 TEST: Google OAuth Adapter Tests
 * 
 * Tests Google OAuth flow including authorization URL generation,
 * token exchange, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GBP_OAUTH_SCOPES, getGbpAuthUrl } from '../../auth/oauth/gbp';
import { getLinkedInAuthUrl } from '../../auth/oauth/linkedin';

describe('Google OAuth Adapter Tests', () => {
  describe('GBP OAuth Authorization URL', () => {
    it('should generate valid authorization URL', () => {
      const clientId = 'test-client-id';
      const redirectUri = 'https://example.com/callback';
      const state = 'abcdefghijklmnopqrstuvwxyz1234567890'; // Must be 32+ chars

      const authUrl = getGbpAuthUrl(clientId, redirectUri, state);

      expect(authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(authUrl).toContain(`client_id=${clientId}`);
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
      expect(authUrl).toContain(`state=${state}`);
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('access_type=offline');
    });

    it('should include required GBP scopes', () => {
      const state = 'abcdefghijklmnopqrstuvwxyz1234567890';
      const authUrl = getGbpAuthUrl('client-id', 'https://example.com/callback', state);

      GBP_OAUTH_SCOPES.forEach(scope => {
        expect(authUrl).toContain(encodeURIComponent(scope));
      });
    });

    it('should validate clientId format', () => {
      const state = 'abcdefghijklmnopqrstuvwxyz1234567890';
      expect(() => {
        getGbpAuthUrl('invalid;client;id', 'https://example.com/callback', state);
      }).toThrow('Invalid clientId');
    });

    it('should require HTTPS redirect URI', () => {
      const state = 'abcdefghijklmnopqrstuvwxyz1234567890';
      expect(() => {
        getGbpAuthUrl('valid-client-id', 'http://example.com/callback', state);
      }).toThrow('Invalid redirectUri');
    });

    it('should validate state parameter - too short', () => {
      expect(() => {
        getGbpAuthUrl('valid-client-id', 'https://example.com/callback', 'tooshort');
      }).toThrow('Invalid state');
    });

    it('should validate state parameter - invalid characters', () => {
      expect(() => {
        getGbpAuthUrl('valid-client-id', 'https://example.com/callback', 'abcdefghijklmnopqrstuvwxyz123456;injection');
      }).toThrow('Invalid state');
    });

    it('should properly URL encode parameters', () => {
      const clientId = 'test-client-123';
      const redirectUri = 'https://example.com/callback?param=value';
      const state = 'abcdefghijklmnopqrstuvwxyz1234567890abc123XYZ';

      const authUrl = getGbpAuthUrl(clientId, redirectUri, state);

      // Should not contain raw special characters
      expect(authUrl).not.toContain(' ');
      expect(authUrl).toContain(encodeURIComponent(redirectUri));
      expect(authUrl).toContain(`state=${state}`);
    });
  });

  describe('LinkedIn OAuth Authorization URL', () => {
    it('should generate valid LinkedIn authorization URL', () => {
      const clientId = 'test-client-id';
      const redirectUri = 'https://example.com/callback';
      const state = 'random-state-token';

      const authUrl = getLinkedInAuthUrl(clientId, redirectUri, state);

      expect(authUrl).toContain('https://www.linkedin.com/oauth/v2/authorization');
      expect(authUrl).toContain(`client_id=${clientId}`);
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
      expect(authUrl).toContain(`state=${state}`);
      expect(authUrl).toContain('response_type=code');
    });

    it('should include LinkedIn required scopes', () => {
      const authUrl = getLinkedInAuthUrl('client-id', 'https://example.com/callback', 'state');
      
      expect(authUrl).toContain('scope=');
      expect(authUrl).toContain('r_liteprofile');
      expect(authUrl).toContain('r_emailaddress');
    });

    it('should validate LinkedIn OAuth parameters', () => {
      expect(() => {
        getLinkedInAuthUrl('', 'https://example.com/callback', 'state');
      }).toThrow();

      expect(() => {
        getLinkedInAuthUrl('client-id', 'http://insecure.com/callback', 'state');
      }).toThrow();
    });
  });
});
