/**
 * Shard Generator Service
 * Generates site-specific shard files from base templates
 *
 * SECURITY FIXES:
 * - P0 #6: HTML entity escaping for all config values in templates
 * - P0 #7: CSS color validation and customCss sanitization
 * - P1 #17: Exported VALID_THEME_IDS for route validation
 */

import { ShardFile } from './shard-deployment';

/**
 * SECURITY FIX P0 #6: Escape HTML entities to prevent XSS in generated templates.
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"'`]/g, (c) => HTML_ESCAPE_MAP[c] || c);
}

/**
 * SECURITY FIX P0 #7: Validate CSS color values.
 * Only allows hex colors (#rgb, #rrggbb, #rrggbbaa) and named CSS colors.
 */
const CSS_COLOR_REGEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_NAMED_COLORS = new Set([
  'red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'orange', 'purple',
  'pink', 'brown', 'cyan', 'magenta', 'yellow', 'navy', 'teal', 'maroon',
  'olive', 'lime', 'aqua', 'fuchsia', 'silver', 'transparent', 'inherit',
]);

function validateCssColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (CSS_COLOR_REGEX.test(trimmed)) return trimmed;
  if (SAFE_NAMED_COLORS.has(trimmed)) return trimmed;
  // Default to a safe color if invalid
  return '#333333';
}

/**
 * SECURITY FIX P0 #7: Sanitize custom CSS to prevent injection.
 * Strips dangerous CSS constructs.
 */
function sanitizeCustomCss(css: string | undefined): string {
  if (!css || typeof css !== 'string') return '';

  return css
    // Remove @import rules (can load external stylesheets)
    .replace(/@import\b[^;]*;?/gi, '')
    // Remove url() references (can exfiltrate data or load external resources)
    .replace(/url\s*\([^)]*\)/gi, '')
    // Remove expression() (IE-specific JS execution in CSS)
    .replace(/expression\s*\([^)]*\)/gi, '')
    // Remove -moz-binding (Firefox-specific JS execution)
    .replace(/-moz-binding\s*:[^;]*/gi, '')
    // Remove behavior: (IE-specific HTC loading)
    .replace(/behavior\s*:[^;]*/gi, '')
    // Remove javascript: in any value
    .replace(/javascript\s*:/gi, '')
    // Remove HTML comments that could break out of style context
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
    // Remove </style> tags that could break out of CSS context
    .replace(/<\/?style[^>]*>/gi, '');
}

/** Valid theme IDs for input validation (P1 #17) */
export const VALID_THEME_IDS = [
  'affiliate-comparison',
  'authority-site',
  'landing-leadgen',
  'local-business',
  'media-newsletter',
];

// Base template for Next.js app
const BASE_TEMPLATE = {
  // Package.json with dependencies
  'package.json': JSON.stringify({
    name: '{{siteName}}',
    version: '1.0.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
    },
    dependencies: {
      next: '^14.0.0',
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
  }, null, 2),

  // Next.js config
  'next.config.js': `module.exports = {
  output: 'standalone',
  poweredByHeader: false,
}`,

  // TypeScript config
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: {
        '@/*': ['./*'],
      },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
    exclude: ['node_modules'],
  }, null, 2),
};

// Theme-specific file generators
const THEME_GENERATORS: Record<string, (config: ThemeConfig) => Record<string, string>> = {
  'affiliate-comparison': (config) => ({
    'pages/index.tsx': generateAffiliateLandingPage(config),
    'pages/_app.tsx': generateAppWrapper(config),
    'styles/globals.css': generateAffiliateStyles(config),
  }),
  
  'authority-site': (config) => ({
    'pages/index.tsx': generateAuthorityLandingPage(config),
    'pages/_app.tsx': generateAppWrapper(config),
    'styles/globals.css': generateAuthorityStyles(config),
  }),
  
  'landing-leadgen': (config) => ({
    'pages/index.tsx': generateLeadGenLandingPage(config),
    'pages/_app.tsx': generateAppWrapper(config),
    'styles/globals.css': generateLeadGenStyles(config),
  }),
  
  'local-business': (config) => ({
    'pages/index.tsx': generateLocalBusinessPage(config),
    'pages/_app.tsx': generateAppWrapper(config),
    'styles/globals.css': generateLocalBusinessStyles(config),
  }),
  
  'media-newsletter': (config) => ({
    'pages/index.tsx': generateNewsletterPage(config),
    'pages/_app.tsx': generateAppWrapper(config),
    'styles/globals.css': generateNewsletterStyles(config),
  }),
};

export interface ThemeConfig {
  siteName: string;
  siteDescription?: string;
  primaryColor: string;
  secondaryColor?: string;
  logoUrl?: string;
  socialLinks?: {
    twitter?: string;
    facebook?: string;
    instagram?: string;
  };
  customCss?: string;
  metaTags?: Record<string, string>;
}

/**
 * Generate all files for a new shard
 */
export function generateShardFiles(
  themeId: string,
  config: ThemeConfig
): ShardFile[] {
  const files: ShardFile[] = [];
  
  // Add base template files
  for (const [path, content] of Object.entries(BASE_TEMPLATE)) {
    files.push({
      path,
      content: replaceTemplateVars(content, config),
    });
  }
  
  // Add theme-specific files
  const themeGenerator = THEME_GENERATORS[themeId];
  if (themeGenerator) {
    const themeFiles = themeGenerator(config);
    for (const [path, content] of Object.entries(themeFiles)) {
      files.push({ path, content });
    }
  }
  
  // Add Vercel config
  files.push({
    path: 'vercel.json',
    content: JSON.stringify({
      regions: ['iad1'],
      headers: [
        {
          source: '/api/(.*)',
          headers: [
            { key: 'Cache-Control', value: 'no-store' },
          ],
        },
      ],
    }, null, 2),
  });
  
  return files;
}

/**
 * Replace template variables in content
 * SECURITY FIX P0 #6: All user-provided values are HTML-escaped
 */
function replaceTemplateVars(content: string, config: ThemeConfig): string {
  return content
    .replace(/\{\{siteName\}\}/g, escapeHtml(config.siteName))
    .replace(/\{\{siteDescription\}\}/g, escapeHtml(config.siteDescription || config.siteName))
    .replace(/\{\{primaryColor\}\}/g, validateCssColor(config.primaryColor))
    .replace(/\{\{logoUrl\}\}/g, escapeHtml(config.logoUrl || ''));
}

// Page generators for each theme
function generateAffiliateLandingPage(config: ThemeConfig): string {
  // SECURITY FIX P0 #6: Escape all user-provided values
  const safeName = escapeHtml(config.siteName);
  const safeDesc = escapeHtml(config.siteDescription || 'Best product comparisons');
  return `import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>${safeName}</title>
        <meta name="description" content="${safeDesc}" />
      </Head>

      <main className="container">
        <header className="header">
          <h1>${safeName}</h1>
          <p>Honest reviews and comparisons</p>
        </header>
        
        <section className="comparison-grid">
          {/* Product comparison cards will be rendered here */}
          <div className="product-card">
            <h2>Product 1</h2>
            <p>Best overall choice</p>
            <button className="cta-button">Check Price</button>
          </div>
        </section>
      </main>
    </>
  );
}`;
}

function generateAuthorityLandingPage(config: ThemeConfig): string {
  const safeName = escapeHtml(config.siteName);
  const safeDesc = escapeHtml(config.siteDescription || 'Expert insights and guides');
  return `import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>${safeName}</title>
        <meta name="description" content="${safeDesc}" />
      </Head>

      <main className="container">
        <header className="hero">
          <h1>${safeName}</h1>
          <p className="tagline">Expert knowledge, trusted guidance</p>
        </header>
        
        <section className="articles">
          <article className="featured-post">
            <h2>Featured Article</h2>
            <p>Deep dive into the topic...</p>
            <a href="#" className="read-more">Read More</a>
          </article>
        </section>
      </main>
    </>
  );
}`;
}

function generateLeadGenLandingPage(config: ThemeConfig): string {
  const safeName = escapeHtml(config.siteName);
  const safeDesc = escapeHtml(config.siteDescription || 'Get your free guide');
  return `import Head from 'next/head';
import { useState } from 'react';

export default function Home() {
  const [email, setEmail] = useState('');

  return (
    <>
      <Head>
        <title>${safeName}</title>
        <meta name="description" content="${safeDesc}" />
      </Head>

      <main className="landing">
        <div className="hero">
          <h1>${safeName}</h1>
          <p>Get instant access to our exclusive guide</p>
          
          <form className="lead-form" onSubmit={(e) => e.preventDefault()}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="cta-button">
              Get Free Access
            </button>
          </form>
        </div>
      </main>
    </>
  );
}`;
}

function generateLocalBusinessPage(config: ThemeConfig): string {
  const safeName = escapeHtml(config.siteName);
  const safeDesc = escapeHtml(config.siteDescription || 'Your local service provider');
  return `import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>${safeName}</title>
        <meta name="description" content="${safeDesc}" />
      </Head>

      <main>
        <header className="business-header">
          <h1>${safeName}</h1>
          <p>Professional services in your area</p>
        </header>
        
        <section className="services">
          <h2>Our Services</h2>
          <ul className="service-list">
            <li>Service 1</li>
            <li>Service 2</li>
            <li>Service 3</li>
          </ul>
          <button className="cta-button">Book Now</button>
        </section>
      </main>
    </>
  );
}`;
}

function generateNewsletterPage(config: ThemeConfig): string {
  const safeName = escapeHtml(config.siteName);
  const safeDesc = escapeHtml(config.siteDescription || 'Daily insights delivered to your inbox');
  return `import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>${safeName}</title>
        <meta name="description" content="${safeDesc}" />
      </Head>

      <main className="newsletter-layout">
        <header>
          <h1>${safeName}</h1>
          <p>Stay informed with our daily digest</p>
        </header>
        
        <section className="subscribe-section">
          <h2>Subscribe Now</h2>
          <form className="subscribe-form">
            <input type="email" placeholder="your@email.com" required />
            <button type="submit" className="cta-button">
              Subscribe
            </button>
          </form>
          <p className="privacy-note">No spam, unsubscribe anytime.</p>
        </section>
        
        <section className="latest-issues">
          <h2>Latest Issues</h2>
          {/* Newsletter archive */}
        </section>
      </main>
    </>
  );
}`;
}

function generateAppWrapper(_config: ThemeConfig): string {
  return `import type { AppProps } from 'next/app';
import './styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}`;
}

// CSS generators — SECURITY FIX P0 #7: Validate colors and sanitize custom CSS
function generateAffiliateStyles(config: ThemeConfig): string {
  const safeColor = validateCssColor(config.primaryColor);
  const safeCss = sanitizeCustomCss(config.customCss);
  return `:root {
  --primary-color: ${safeColor};
  --text-color: #333;
  --bg-color: #f5f5f5;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-color);
  color: var(--text-color);
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.header {
  text-align: center;
  padding: 3rem 0;
}

.header h1 {
  font-size: 2.5rem;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  margin-top: 2rem;
}

.product-card {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.cta-button {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  margin-top: 1rem;
}

.cta-button:hover {
  opacity: 0.9;
}

${safeCss}`;
}

function generateAuthorityStyles(config: ThemeConfig): string {
  const safeColor = validateCssColor(config.primaryColor);
  const safeCss = sanitizeCustomCss(config.customCss);
  return `:root {
  --primary-color: ${safeColor};
  --text-color: #2c3e50;
  --bg-color: #ffffff;
}

body {
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1.6;
  color: var(--text-color);
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

.hero {
  text-align: center;
  padding: 4rem 0;
  border-bottom: 2px solid var(--primary-color);
  margin-bottom: 3rem;
}

.hero h1 {
  font-size: 3rem;
  color: var(--primary-color);
}

.tagline {
  font-size: 1.25rem;
  font-style: italic;
  color: #666;
}

.featured-post {
  padding: 2rem 0;
}

.read-more {
  color: var(--primary-color);
  text-decoration: none;
  font-weight: bold;
}

${safeCss}`;
}

function generateLeadGenStyles(config: ThemeConfig): string {
  const safeColor = validateCssColor(config.primaryColor);
  const safeAccent = validateCssColor(config.secondaryColor || '#ff6b6b');
  const safeCss = sanitizeCustomCss(config.customCss);
  return `:root {
  --primary-color: ${safeColor};
  --accent-color: ${safeAccent};
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 0;
}

.landing {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
}

.hero {
  text-align: center;
  color: white;
  padding: 2rem;
  max-width: 600px;
}

.hero h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.lead-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 2rem;
}

.lead-form input {
  padding: 1rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
}

.cta-button {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 4px;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
}

${safeCss}`;
}

function generateLocalBusinessStyles(config: ThemeConfig): string {
  const safeColor = validateCssColor(config.primaryColor);
  const safeCss = sanitizeCustomCss(config.customCss);
  return `:root {
  --primary-color: ${safeColor};
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.business-header {
  text-align: center;
  padding: 3rem 1rem;
  background: var(--primary-color);
  color: white;
}

.business-header h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.services {
  max-width: 600px;
  margin: 3rem auto;
  padding: 0 1rem;
}

.service-list {
  list-style: none;
  padding: 0;
}

.service-list li {
  padding: 1rem;
  border-bottom: 1px solid #eee;
}

.cta-button {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 4px;
  font-size: 1.1rem;
  cursor: pointer;
  display: block;
  margin: 2rem auto;
}

${safeCss}`;
}

function generateNewsletterStyles(config: ThemeConfig): string {
  const safeColor = validateCssColor(config.primaryColor);
  const safeCss = sanitizeCustomCss(config.customCss);
  return `:root {
  --primary-color: ${safeColor};
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
}

.newsletter-layout {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  text-align: center;
  padding: 2rem 0;
}

header h1 {
  color: var(--primary-color);
}

.subscribe-section {
  background: #f8f9fa;
  padding: 2rem;
  border-radius: 8px;
  margin: 2rem 0;
  text-align: center;
}

.subscribe-form {
  display: flex;
  gap: 0.5rem;
  max-width: 400px;
  margin: 1rem auto;
}

.subscribe-form input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.cta-button {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
}

.privacy-note {
  font-size: 0.875rem;
  color: #666;
}

${safeCss}`;
}
