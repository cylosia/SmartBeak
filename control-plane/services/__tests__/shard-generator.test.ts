/**
 * P2 TEST: Shard Generator - Template Generation Tests
 *
 * Tests file generation, HTML escaping, CSS color validation,
 * custom CSS sanitization, and theme-specific output.
 */

import { describe, it, expect } from 'vitest';
import {
  generateShardFiles,
  VALID_THEME_IDS,
  type ThemeConfig,
} from '../shard-generator';

describe('Shard Generator', () => {
  const baseConfig: ThemeConfig = {
    siteName: 'Test Site',
    siteDescription: 'A test website',
    primaryColor: '#336699',
  };

  // ============================================================================
  // generateShardFiles
  // ============================================================================

  describe('generateShardFiles', () => {
    it('should generate base template files for any theme', () => {
      const files = generateShardFiles('affiliate-comparison', baseConfig);
      const paths = files.map(f => f.path);

      expect(paths).toContain('package.json');
      expect(paths).toContain('next.config.js');
      expect(paths).toContain('tsconfig.json');
      expect(paths).toContain('vercel.json');
    });

    it('should generate theme-specific files for affiliate-comparison', () => {
      const files = generateShardFiles('affiliate-comparison', baseConfig);
      const paths = files.map(f => f.path);

      expect(paths).toContain('pages/index.tsx');
      expect(paths).toContain('pages/_app.tsx');
      expect(paths).toContain('styles/globals.css');
    });

    it('should generate theme-specific files for authority-site', () => {
      const files = generateShardFiles('authority-site', baseConfig);
      const paths = files.map(f => f.path);

      expect(paths).toContain('pages/index.tsx');
      expect(paths).toContain('pages/_app.tsx');
      expect(paths).toContain('styles/globals.css');
    });

    it('should generate files for all valid theme IDs', () => {
      for (const themeId of VALID_THEME_IDS) {
        const files = generateShardFiles(themeId, baseConfig);
        expect(files.length).toBeGreaterThan(3); // At least base + theme files
      }
    });

    it('should still generate base files for unknown theme ID', () => {
      const files = generateShardFiles('unknown-theme', baseConfig);
      const paths = files.map(f => f.path);

      // Base files + vercel.json should still be generated
      expect(paths).toContain('package.json');
      expect(paths).toContain('vercel.json');
      // No theme-specific files
      expect(paths).not.toContain('pages/index.tsx');
    });

    it('should replace {{siteName}} in package.json', () => {
      const files = generateShardFiles('affiliate-comparison', baseConfig);
      const pkg = files.find(f => f.path === 'package.json');
      expect(pkg!.content).toContain('Test Site');
    });

    it('should include vercel.json with IAD1 region', () => {
      const files = generateShardFiles('affiliate-comparison', baseConfig);
      const vercel = files.find(f => f.path === 'vercel.json');
      const config = JSON.parse(vercel!.content);
      expect(config.regions).toContain('iad1');
    });
  });

  // ============================================================================
  // HTML Escaping (XSS prevention)
  // ============================================================================

  describe('HTML escaping', () => {
    it('should escape HTML entities in siteName', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        siteName: '<script>alert("xss")</script>',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const page = files.find(f => f.path === 'pages/index.tsx');

      expect(page!.content).not.toContain('<script>');
      expect(page!.content).toContain('&lt;script&gt;');
    });

    it('should escape quotes in siteDescription', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        siteDescription: 'A "test" with <em>HTML</em>',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const page = files.find(f => f.path === 'pages/index.tsx');

      expect(page!.content).toContain('&quot;test&quot;');
      expect(page!.content).toContain('&lt;em&gt;');
    });

    it('should escape ampersands', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        siteName: 'Tom & Jerry',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const pkg = files.find(f => f.path === 'package.json');
      expect(pkg!.content).toContain('Tom &amp; Jerry');
    });
  });

  // ============================================================================
  // CSS Color Validation
  // ============================================================================

  describe('CSS color validation', () => {
    it('should accept valid hex color', () => {
      const config: ThemeConfig = { ...baseConfig, primaryColor: '#ff5500' };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).toContain('#ff5500');
    });

    it('should accept shorthand hex color', () => {
      const config: ThemeConfig = { ...baseConfig, primaryColor: '#f50' };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).toContain('#f50');
    });

    it('should accept named CSS colors', () => {
      const config: ThemeConfig = { ...baseConfig, primaryColor: 'navy' };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).toContain('navy');
    });

    it('should reject and default invalid color values', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        primaryColor: 'url(javascript:alert(1))',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      // Should default to safe color, not include the malicious value
      expect(css!.content).not.toContain('javascript');
      expect(css!.content).toContain('#333333');
    });
  });

  // ============================================================================
  // Custom CSS Sanitization
  // ============================================================================

  describe('custom CSS sanitization', () => {
    it('should strip @import rules', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        customCss: '@import url("https://evil.com/steal.css"); .safe { color: red; }',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).not.toContain('@import');
      expect(css!.content).toContain('.safe { color: red; }');
    });

    it('should strip url() references', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        customCss: '.bg { background: url(https://evil.com/track.gif); }',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).not.toContain('url(');
    });

    it('should strip expression()', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        customCss: '.ie { width: expression(document.body.clientWidth); }',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).not.toContain('expression(');
    });

    it('should strip javascript: in CSS', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        customCss: '.evil { background: javascript:alert(1); }',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).not.toContain('javascript:');
    });

    it('should strip </style> tags', () => {
      const config: ThemeConfig = {
        ...baseConfig,
        customCss: '</style><script>alert(1)</script><style>',
      };
      const files = generateShardFiles('affiliate-comparison', config);
      const css = files.find(f => f.path === 'styles/globals.css');
      expect(css!.content).not.toContain('</style>');
      expect(css!.content).not.toContain('<script>');
    });
  });

  // ============================================================================
  // VALID_THEME_IDS
  // ============================================================================

  describe('VALID_THEME_IDS', () => {
    it('should contain expected themes', () => {
      expect(VALID_THEME_IDS).toContain('affiliate-comparison');
      expect(VALID_THEME_IDS).toContain('authority-site');
      expect(VALID_THEME_IDS).toContain('landing-leadgen');
      expect(VALID_THEME_IDS).toContain('local-business');
      expect(VALID_THEME_IDS).toContain('media-newsletter');
    });

    it('should have exactly 5 themes', () => {
      expect(VALID_THEME_IDS).toHaveLength(5);
    });
  });
});
