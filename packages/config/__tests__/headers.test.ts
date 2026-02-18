/**
 * Security Headers Configuration Tests
 *
 * Regression tests to ensure canonical header values are not accidentally
 * loosened. These tests guard against CSP relaxation, missing directives,
 * and header inconsistencies.
 */

import {
  BASE_SECURITY_HEADERS,
  CSP_API,
  buildWebAppCsp,
  CSP_THEMES,
  PERMISSIONS_POLICY_WEB_APP,
  PERMISSIONS_POLICY_API,
  PERMISSIONS_POLICY_THEMES,
} from '../headers';

describe('BASE_SECURITY_HEADERS', () => {
  it('should contain all required security headers', () => {
    const requiredKeys = [
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-XSS-Protection',
      'Strict-Transport-Security',
      'X-DNS-Prefetch-Control',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      // P2-FIX: Added COEP — was present in headers.ts but absent from this test,
      // so accidental removal would not be caught by CI.
      'Cross-Origin-Embedder-Policy',
    ];

    for (const key of requiredKeys) {
      expect(BASE_SECURITY_HEADERS).toHaveProperty(key);
    }
  });

  it('should use X-XSS-Protection: 0 (modern recommendation)', () => {
    expect(BASE_SECURITY_HEADERS['X-XSS-Protection']).toBe('0');
  });

  it('should include preload in HSTS', () => {
    expect(BASE_SECURITY_HEADERS['Strict-Transport-Security']).toContain('preload');
  });

  it('should set X-Frame-Options to DENY', () => {
    expect(BASE_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });

  it('should set COOP to same-origin', () => {
    expect(BASE_SECURITY_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('should set CORP to same-origin', () => {
    expect(BASE_SECURITY_HEADERS['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('should set COEP to require-corp', () => {
    expect(BASE_SECURITY_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });
});

describe('CSP_API', () => {
  it('should set all resource directives to none for JSON-only API', () => {
    const noneDirectives = [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'object-src',
    ];

    for (const directive of noneDirectives) {
      expect(CSP_API).toContain(`${directive} 'none'`);
    }
  });

  it('should set frame-ancestors to none', () => {
    expect(CSP_API).toContain("frame-ancestors 'none'");
  });

  it('should set base-uri to none', () => {
    expect(CSP_API).toContain("base-uri 'none'");
  });

  it('should set form-action to none', () => {
    expect(CSP_API).toContain("form-action 'none'");
  });

  it('should include upgrade-insecure-requests', () => {
    expect(CSP_API).toContain('upgrade-insecure-requests');
  });

  it('should NOT contain self (API serves no HTML/JS/CSS)', () => {
    expect(CSP_API).not.toContain("'self'");
  });
});

describe('buildWebAppCsp', () => {
  const testNonce = 'dGVzdC1ub25jZQ==';
  const csp = buildWebAppCsp(testNonce);

  // P0-FIX: Regression tests for nonce injection. An unvalidated nonce containing
  // special characters could inject 'unsafe-inline' or additional CSP directives,
  // completely undermining the nonce-based script allowlist.
  it('should reject nonce with single quote (CSP injection vector)', () => {
    expect(() => buildWebAppCsp("abc' 'unsafe-inline")).toThrow('invalid nonce');
  });

  it('should reject nonce with semicolon (directive injection vector)', () => {
    expect(() => buildWebAppCsp("abc; script-src *")).toThrow('invalid nonce');
  });

  it('should reject nonce shorter than 22 characters (insufficient entropy)', () => {
    expect(() => buildWebAppCsp('short')).toThrow('invalid nonce');
  });

  it('should reject empty nonce', () => {
    expect(() => buildWebAppCsp('')).toThrow('invalid nonce');
  });

  it('should accept valid base64 nonce of sufficient length', () => {
    expect(() => buildWebAppCsp(testNonce)).not.toThrow();
  });

  it('should include nonce in script-src', () => {
    expect(csp).toContain(`'nonce-${testNonce}'`);
    expect(csp).toMatch(new RegExp(`script-src[^;]*'nonce-${testNonce}'`));
  });

  it('should include nonce in style-src', () => {
    expect(csp).toMatch(new RegExp(`style-src[^;]*'nonce-${testNonce}'`));
  });

  it('should include object-src none', () => {
    expect(csp).toContain("object-src 'none'");
  });

  it('should include worker-src self', () => {
    expect(csp).toContain("worker-src 'self'");
  });

  it('should include upgrade-insecure-requests', () => {
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('should NOT contain blanket https: in img-src', () => {
    // img-src should list specific domains, not a blanket https:
    const imgSrcMatch = csp.match(/img-src ([^;]+)/);
    expect(imgSrcMatch).toBeTruthy();
    const imgSrcValue = imgSrcMatch![1];
    // Should contain specific domains
    expect(imgSrcValue).toContain('https://img.clerk.com');
    expect(imgSrcValue).toContain('https://images.clerk.dev');
    expect(imgSrcValue).toContain('https://files.stripe.com');
    // Should NOT contain a blanket https: (which allows any HTTPS source)
    // Match standalone "https:" not followed by "//" (i.e. not a specific domain)
    expect(imgSrcValue).not.toMatch(/https:(?!\/\/)/);
  });

  it('should include frame-ancestors none', () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should include Clerk and Stripe in connect-src', () => {
    expect(csp).toContain('https://*.clerk.accounts.dev');
    expect(csp).toContain('https://api.stripe.com');
  });
});

describe('CSP_THEMES', () => {
  it('should include object-src none', () => {
    expect(CSP_THEMES).toContain("object-src 'none'");
  });

  it('should include upgrade-insecure-requests', () => {
    expect(CSP_THEMES).toContain('upgrade-insecure-requests');
  });

  it('should NOT contain blanket https: in img-src', () => {
    const imgSrcMatch = CSP_THEMES.match(/img-src ([^;]+)/);
    expect(imgSrcMatch).toBeTruthy();
    expect(imgSrcMatch![1]).not.toMatch(/https:(?!\/\/)/);
  });

  it('should include frame-ancestors none', () => {
    expect(CSP_THEMES).toContain("frame-ancestors 'none'");
  });
});

describe('Permissions-Policy variants', () => {
  it('web app policy should include payment=(self)', () => {
    expect(PERMISSIONS_POLICY_WEB_APP).toContain('payment=(self)');
  });

  it('API policy should fully restrict payment', () => {
    expect(PERMISSIONS_POLICY_API).toContain('payment=()');
    expect(PERMISSIONS_POLICY_API).not.toContain('payment=(self)');
  });

  it('themes policy should fully restrict payment', () => {
    expect(PERMISSIONS_POLICY_THEMES).toContain('payment=()');
    expect(PERMISSIONS_POLICY_THEMES).not.toContain('payment=(self)');
  });

  it('all policies should restrict camera, microphone, geolocation', () => {
    for (const policy of [PERMISSIONS_POLICY_WEB_APP, PERMISSIONS_POLICY_API, PERMISSIONS_POLICY_THEMES]) {
      expect(policy).toContain('camera=()');
      expect(policy).toContain('microphone=()');
      expect(policy).toContain('geolocation=()');
    }
  });

  it('all policies should restrict sensor APIs', () => {
    for (const policy of [PERMISSIONS_POLICY_WEB_APP, PERMISSIONS_POLICY_API, PERMISSIONS_POLICY_THEMES]) {
      expect(policy).toContain('usb=()');
      expect(policy).toContain('magnetometer=()');
      expect(policy).toContain('gyroscope=()');
      expect(policy).toContain('accelerometer=()');
    }
  });
});
