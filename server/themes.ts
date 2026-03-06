import type { ThemeOption } from "@shared/schema";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ThemeConfig {
  name: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  icon: string;
}

const THEME_CONFIGS: Record<ThemeOption, ThemeConfig> = {
  "affiliate-comparison": {
    name: "Affiliate Comparison",
    description: "Product comparison & affiliate marketing site",
    primaryColor: "#6366f1",
    accentColor: "#818cf8",
    fontFamily: "'Inter', sans-serif",
    icon: "comparison",
  },
  "authority-site": {
    name: "Authority Site",
    description: "Authoritative content & knowledge hub",
    primaryColor: "#0f172a",
    accentColor: "#3b82f6",
    fontFamily: "'Merriweather', serif",
    icon: "authority",
  },
  "landing-leadgen": {
    name: "Landing Page - Lead Gen",
    description: "High-converting lead generation landing page",
    primaryColor: "#059669",
    accentColor: "#34d399",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    icon: "leadgen",
  },
  "local-business": {
    name: "Local Business",
    description: "Professional local business website",
    primaryColor: "#dc2626",
    accentColor: "#f97316",
    fontFamily: "'Open Sans', sans-serif",
    icon: "business",
  },
  "media-newsletter": {
    name: "Media & Newsletter",
    description: "Media publication & newsletter signup",
    primaryColor: "#7c3aed",
    accentColor: "#a78bfa",
    fontFamily: "'Playfair Display', serif",
    icon: "newsletter",
  },
};

export function getThemeConfig(theme: ThemeOption): ThemeConfig {
  return THEME_CONFIGS[theme];
}

export function getThemeConfigs(): Record<ThemeOption, ThemeConfig> {
  return THEME_CONFIGS;
}

function generateAffiliateComparison(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(domainName)} - Best Product Comparisons</title>
<meta name="description" content="Compare top products side by side. Find the best deals and honest reviews at ${escapeHtml(domainName)}.">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1e293b;background:#f8fafc}
.nav{background:#fff;border-bottom:1px solid #e2e8f0;padding:16px 0;position:sticky;top:0;z-index:50}
.container{max-width:1200px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:700;font-size:1.5rem;color:#6366f1}
.nav-links{display:flex;gap:32px;list-style:none}
.nav-links a{color:#64748b;text-decoration:none;font-weight:500;transition:color .2s}
.nav-links a:hover{color:#6366f1}
.hero{background:linear-gradient(135deg,#6366f1 0%,#818cf8 100%);padding:80px 0;text-align:center;color:#fff}
.hero h1{font-size:3rem;font-weight:700;margin-bottom:16px}
.hero p{font-size:1.25rem;opacity:.9;max-width:600px;margin:0 auto 32px}
.hero-badge{background:rgba(255,255,255,.2);display:inline-block;padding:8px 20px;border-radius:100px;font-size:.875rem;font-weight:500;margin-bottom:24px}
.search-box{max-width:500px;margin:0 auto;position:relative}
.search-box input{width:100%;padding:16px 24px;border-radius:12px;border:none;font-size:1rem;box-shadow:0 4px 24px rgba(0,0,0,.15)}
.categories{padding:64px 0;background:#fff}
.section-title{text-align:center;font-size:2rem;font-weight:700;margin-bottom:48px}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px}
.card{border:1px solid #e2e8f0;border-radius:16px;padding:32px;transition:box-shadow .3s,transform .2s}
.card:hover{box-shadow:0 8px 30px rgba(0,0,0,.08);transform:translateY(-2px)}
.card-icon{width:48px;height:48px;background:#eef2ff;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:1.5rem}
.card h3{font-size:1.25rem;font-weight:600;margin-bottom:8px}
.card p{color:#64748b;line-height:1.6}
.comparison{padding:64px 0}
.comp-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden}
.comp-table th{background:#f1f5f9;padding:16px 24px;text-align:left;font-weight:600;font-size:.875rem;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
.comp-table td{padding:16px 24px;border-top:1px solid #e2e8f0}
.comp-table tr:hover td{background:#f8fafc}
.badge{display:inline-block;padding:4px 12px;border-radius:100px;font-size:.75rem;font-weight:600}
.badge-green{background:#dcfce7;color:#166534}.badge-blue{background:#dbeafe;color:#1e40af}
.stars{color:#f59e0b}
.cta{background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;transition:background .2s}
.cta:hover{background:#4f46e5}
.footer{background:#0f172a;color:#94a3b8;padding:48px 0;text-align:center}
.footer p{margin-bottom:8px}
</style>
</head>
<body>
<nav class="nav"><div class="container"><div class="nav-inner">
<div class="logo">${escapeHtml(domainName)}</div>
<ul class="nav-links"><li><a href="#">Reviews</a></li><li><a href="#">Categories</a></li><li><a href="#">Deals</a></li><li><a href="#">About</a></li></ul>
</div></div></nav>
<section class="hero"><div class="container">
<div class="hero-badge">Trusted by 50,000+ readers</div>
<h1>Find the Perfect Product</h1>
<p>Unbiased comparisons, expert reviews, and the best deals — all in one place.</p>
<div class="search-box"><input type="text" placeholder="Search products to compare..."></div>
</div></section>
<section class="categories"><div class="container">
<h2 class="section-title">Popular Categories</h2>
<div class="grid-3">
<div class="card"><div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div><h3>Laptops & Computers</h3><p>Compare specs, performance, and value across top laptop brands and models.</p></div>
<div class="card"><div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg></div><h3>Smartphones</h3><p>Side-by-side phone comparisons with camera tests, battery life, and more.</p></div>
<div class="card"><div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div><h3>Audio & Headphones</h3><p>Find the best headphones, speakers, and audio gear for your needs.</p></div>
</div></div></section>
<section class="comparison"><div class="container">
<h2 class="section-title">Top Comparisons This Week</h2>
<table class="comp-table">
<thead><tr><th>Product</th><th>Rating</th><th>Price</th><th>Best For</th><th></th></tr></thead>
<tbody>
<tr><td><strong>Product Alpha Pro</strong></td><td><span class="stars">★★★★★</span> 4.9</td><td>$299</td><td><span class="badge badge-green">Best Overall</span></td><td><a href="#" class="cta">Compare</a></td></tr>
<tr><td><strong>Product Beta Max</strong></td><td><span class="stars">★★★★</span> 4.7</td><td>$249</td><td><span class="badge badge-blue">Best Value</span></td><td><a href="#" class="cta">Compare</a></td></tr>
<tr><td><strong>Product Gamma Ultra</strong></td><td><span class="stars">★★★★</span> 4.5</td><td>$199</td><td><span class="badge badge-blue">Budget Pick</span></td><td><a href="#" class="cta">Compare</a></td></tr>
</tbody></table>
</div></section>
<footer class="footer"><div class="container">
<p style="font-size:1.25rem;color:#fff;font-weight:700;margin-bottom:16px">${escapeHtml(domainName)}</p>
<p>Honest reviews and comparisons you can trust.</p>
<p style="margin-top:24px;font-size:.875rem">Built with SmartBeak SmartDeploy</p>
</div></footer>
</body></html>`;
}

function generateAuthoritySite(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(domainName)} - Expert Knowledge Hub</title>
<meta name="description" content="${escapeHtml(domainName)} is your authoritative source for in-depth articles, research, and expert insights.">
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1e293b;background:#fff}
.nav{border-bottom:1px solid #e2e8f0;padding:20px 0}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-family:'Merriweather',serif;font-weight:700;font-size:1.75rem;color:#0f172a}
.nav-links{display:flex;gap:32px;list-style:none}
.nav-links a{color:#475569;text-decoration:none;font-weight:500;font-size:.9rem;transition:color .2s}
.nav-links a:hover{color:#3b82f6}
.hero{padding:80px 0 60px;border-bottom:1px solid #e2e8f0}
.hero-label{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#3b82f6;margin-bottom:16px}
.hero h1{font-family:'Merriweather',serif;font-size:3rem;font-weight:700;line-height:1.3;margin-bottom:20px;max-width:700px}
.hero p{font-size:1.15rem;color:#64748b;line-height:1.7;max-width:600px}
.content{padding:64px 0}
.grid-2{display:grid;grid-template-columns:2fr 1fr;gap:48px}
.articles{display:flex;flex-direction:column;gap:32px}
.article{padding-bottom:32px;border-bottom:1px solid #f1f5f9}
.article-meta{font-size:.8rem;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.article h2{font-family:'Merriweather',serif;font-size:1.5rem;font-weight:700;margin-bottom:8px;line-height:1.4}
.article h2 a{color:#0f172a;text-decoration:none;transition:color .2s}
.article h2 a:hover{color:#3b82f6}
.article p{color:#64748b;line-height:1.7}
.read-more{color:#3b82f6;text-decoration:none;font-weight:600;font-size:.9rem;margin-top:12px;display:inline-block}
.sidebar{display:flex;flex-direction:column;gap:32px}
.widget{background:#f8fafc;border-radius:12px;padding:24px}
.widget h3{font-weight:700;font-size:1rem;margin-bottom:16px;color:#0f172a}
.widget ul{list-style:none;display:flex;flex-direction:column;gap:12px}
.widget li a{color:#475569;text-decoration:none;font-size:.9rem;transition:color .2s}
.widget li a:hover{color:#3b82f6}
.subscribe-box{background:#0f172a;border-radius:12px;padding:32px;color:#fff}
.subscribe-box h3{color:#fff;margin-bottom:8px}
.subscribe-box p{color:#94a3b8;font-size:.9rem;margin-bottom:16px}
.subscribe-box input{width:100%;padding:12px 16px;border-radius:8px;border:none;margin-bottom:12px;font-size:.9rem}
.btn{background:#3b82f6;color:#fff;padding:12px 24px;border:none;border-radius:8px;font-weight:600;cursor:pointer;width:100%;font-size:.9rem;transition:background .2s}
.btn:hover{background:#2563eb}
.footer{border-top:1px solid #e2e8f0;padding:32px 0;text-align:center;color:#94a3b8;font-size:.875rem}
@media(max-width:768px){.grid-2{grid-template-columns:1fr}}
</style>
</head>
<body>
<nav class="nav"><div class="container"><div class="nav-inner">
<div class="logo">${escapeHtml(domainName)}</div>
<ul class="nav-links"><li><a href="#">Articles</a></li><li><a href="#">Research</a></li><li><a href="#">Guides</a></li><li><a href="#">About</a></li></ul>
</div></div></nav>
<section class="hero"><div class="container">
<div class="hero-label">Featured</div>
<h1>Insights That Shape the Future of Industry</h1>
<p>Deep-dive analysis, expert perspectives, and research-backed content to keep you ahead of the curve.</p>
</div></section>
<section class="content"><div class="container"><div class="grid-2">
<div class="articles">
<div class="article"><div class="article-meta">Analysis &bull; 12 min read</div><h2><a href="#">The Complete Guide to Strategic Decision Making in 2025</a></h2><p>An in-depth exploration of frameworks and mental models that top executives use to make better decisions under uncertainty.</p><a href="#" class="read-more">Read full article →</a></div>
<div class="article"><div class="article-meta">Research &bull; 8 min read</div><h2><a href="#">Understanding Market Dynamics: A Data-Driven Approach</a></h2><p>How modern analytics and AI-driven insights are transforming the way organizations understand and respond to market shifts.</p><a href="#" class="read-more">Read full article →</a></div>
<div class="article"><div class="article-meta">Guide &bull; 15 min read</div><h2><a href="#">Building Resilient Systems: Lessons from Industry Leaders</a></h2><p>Key principles and practical strategies for creating systems that thrive in volatile, uncertain environments.</p><a href="#" class="read-more">Read full article →</a></div>
</div>
<div class="sidebar">
<div class="subscribe-box"><h3>Stay Informed</h3><p>Get weekly insights delivered to your inbox.</p><input type="email" placeholder="your@email.com"><button class="btn">Subscribe Free</button></div>
<div class="widget"><h3>Popular Topics</h3><ul><li><a href="#">Strategy & Leadership</a></li><li><a href="#">Data & Analytics</a></li><li><a href="#">Innovation & Technology</a></li><li><a href="#">Organizational Design</a></li><li><a href="#">Market Research</a></li></ul></div>
</div>
</div></div></section>
<footer class="footer"><div class="container"><p>${escapeHtml(domainName)} &bull; Expert Knowledge Hub &bull; Built with SmartBeak SmartDeploy</p></div></footer>
</body></html>`;
}

function generateLandingLeadgen(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(domainName)} - Transform Your Business Today</title>
<meta name="description" content="Discover how ${escapeHtml(domainName)} helps businesses grow faster with proven strategies and tools.">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Plus Jakarta Sans',sans-serif;color:#1e293b}
.nav{padding:16px 0;position:absolute;top:0;left:0;right:0;z-index:50}
.container{max-width:1200px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:800;font-size:1.5rem;color:#fff}
.nav-links{display:flex;gap:32px;list-style:none}
.nav-links a{color:rgba(255,255,255,.8);text-decoration:none;font-weight:500;transition:color .2s}
.nav-links a:hover{color:#fff}
.nav-cta{background:#fff;color:#059669;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;transition:transform .2s}
.nav-cta:hover{transform:translateY(-1px)}
.hero{background:linear-gradient(135deg,#059669 0%,#34d399 50%,#6ee7b7 100%);padding:140px 0 100px;text-align:center;color:#fff;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;right:-20%;width:600px;height:600px;background:rgba(255,255,255,.05);border-radius:50%}
.hero::after{content:'';position:absolute;bottom:-30%;left:-10%;width:400px;height:400px;background:rgba(255,255,255,.05);border-radius:50%}
.hero-content{position:relative;z-index:1}
.hero-pill{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.15);padding:8px 20px;border-radius:100px;font-size:.875rem;margin-bottom:24px;backdrop-filter:blur(4px)}
.hero h1{font-size:3.5rem;font-weight:800;line-height:1.15;margin-bottom:20px;max-width:800px;margin-left:auto;margin-right:auto}
.hero p{font-size:1.25rem;opacity:.9;max-width:550px;margin:0 auto 40px;line-height:1.6}
.hero-form{max-width:480px;margin:0 auto;display:flex;gap:12px}
.hero-form input{flex:1;padding:16px 20px;border-radius:12px;border:none;font-size:1rem;font-family:inherit}
.hero-form button{padding:16px 32px;background:#0f172a;color:#fff;border:none;border-radius:12px;font-weight:700;font-size:1rem;cursor:pointer;transition:transform .2s;font-family:inherit;white-space:nowrap}
.hero-form button:hover{transform:translateY(-1px)}
.social-proof{padding:48px 0;background:#f8fafc;text-align:center}
.social-proof p{color:#94a3b8;font-size:.875rem;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:24px}
.logos{display:flex;justify-content:center;align-items:center;gap:48px;flex-wrap:wrap;opacity:.4}
.logos span{font-size:1.5rem;font-weight:700;color:#475569}
.features{padding:80px 0}
.features .section-title{text-align:center;font-size:2.25rem;font-weight:800;margin-bottom:16px}
.features .section-sub{text-align:center;color:#64748b;font-size:1.1rem;margin-bottom:56px;max-width:500px;margin-left:auto;margin-right:auto}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.feat-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;transition:box-shadow .3s}
.feat-card:hover{box-shadow:0 8px 30px rgba(0,0,0,.06)}
.feat-icon{width:52px;height:52px;background:linear-gradient(135deg,#dcfce7,#a7f3d0);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;font-size:1.5rem}
.feat-card h3{font-size:1.2rem;font-weight:700;margin-bottom:8px}
.feat-card p{color:#64748b;line-height:1.6;font-size:.95rem}
.cta-section{background:#0f172a;padding:80px 0;text-align:center;color:#fff}
.cta-section h2{font-size:2.5rem;font-weight:800;margin-bottom:16px}
.cta-section p{color:#94a3b8;font-size:1.1rem;margin-bottom:32px}
.cta-btn{background:#059669;color:#fff;padding:16px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:1.1rem;display:inline-block;transition:background .2s}
.cta-btn:hover{background:#047857}
.footer{padding:32px 0;text-align:center;color:#94a3b8;font-size:.875rem;border-top:1px solid #e2e8f0}
@media(max-width:640px){.hero h1{font-size:2rem}.hero-form{flex-direction:column}}
</style>
</head>
<body>
<nav class="nav"><div class="container"><div class="nav-inner">
<div class="logo">${escapeHtml(domainName)}</div>
<ul class="nav-links"><li><a href="#">Features</a></li><li><a href="#">Pricing</a></li><li><a href="#">Testimonials</a></li></ul>
<a href="#" class="nav-cta">Get Started</a>
</div></div></nav>
<section class="hero"><div class="container"><div class="hero-content">
<div class="hero-pill">New: AI-Powered Analytics Dashboard</div>
<h1>Grow Your Business 10x Faster</h1>
<p>Join thousands of companies using our platform to accelerate growth, increase conversions, and scale effortlessly.</p>
<div class="hero-form"><input type="email" placeholder="Enter your work email"><button>Start Free Trial</button></div>
<p style="margin-top:16px;font-size:.875rem;opacity:.7">No credit card required. 14-day free trial.</p>
</div></div></section>
<section class="social-proof"><div class="container">
<p>Trusted by forward-thinking companies</p>
<div class="logos"><span>Acme Inc</span><span>TechCorp</span><span>Global AI</span><span>DataFlow</span><span>ScaleUp</span></div>
</div></section>
<section class="features"><div class="container">
<h2 class="section-title">Everything You Need</h2>
<p class="section-sub">Powerful tools designed to help you succeed at every stage of growth.</p>
<div class="grid-3">
<div class="feat-card"><div class="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div><h3>Lightning Fast Setup</h3><p>Get up and running in minutes, not days. Our intuitive onboarding guides you every step of the way.</p></div>
<div class="feat-card"><div class="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><h3>Smart Analytics</h3><p>Understand your data with AI-powered insights that turn numbers into actionable strategies.</p></div>
<div class="feat-card"><div class="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><h3>Enterprise Security</h3><p>Bank-grade encryption and compliance certifications to keep your data safe and secure.</p></div>
</div></div></section>
<section class="cta-section"><div class="container">
<h2>Ready to Transform Your Business?</h2>
<p>Join 10,000+ companies already growing with us.</p>
<a href="#" class="cta-btn">Start Your Free Trial →</a>
</div></section>
<footer class="footer"><div class="container"><p>${escapeHtml(domainName)} &bull; Built with SmartBeak SmartDeploy</p></div></footer>
</body></html>`;
}

function generateLocalBusiness(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(domainName)} - Your Local Business</title>
<meta name="description" content="${escapeHtml(domainName)} - Quality service, trusted by your community. Contact us today.">
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Open Sans',sans-serif;color:#1e293b}
.nav{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:16px 0;position:sticky;top:0;z-index:50}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:700;font-size:1.5rem;color:#dc2626}
.nav-links{display:flex;gap:28px;list-style:none}
.nav-links a{color:#475569;text-decoration:none;font-weight:600;font-size:.9rem;transition:color .2s}
.nav-links a:hover{color:#dc2626}
.phone{color:#dc2626;font-weight:700;font-size:1rem;text-decoration:none}
.hero{background:linear-gradient(135deg,#dc2626 0%,#f97316 100%);padding:80px 0;color:#fff}
.hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.hero h1{font-size:2.75rem;font-weight:700;line-height:1.2;margin-bottom:16px}
.hero p{font-size:1.1rem;opacity:.9;line-height:1.7;margin-bottom:32px}
.hero-btn{display:inline-block;background:#fff;color:#dc2626;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;transition:transform .2s}
.hero-btn:hover{transform:translateY(-2px)}
.hero-img{background:rgba(255,255,255,.1);border-radius:16px;height:320px;display:flex;align-items:center;justify-content:center;font-size:4rem;backdrop-filter:blur(4px)}
.stats{padding:48px 0;background:#fff;border-bottom:1px solid #f1f5f9}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center}
.stat-num{font-size:2.5rem;font-weight:700;color:#dc2626}
.stat-label{color:#64748b;font-size:.9rem;margin-top:4px}
.services{padding:64px 0;background:#f8fafc}
.section-title{text-align:center;font-size:2rem;font-weight:700;margin-bottom:12px}
.section-sub{text-align:center;color:#64748b;margin-bottom:48px}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.service-card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.04);transition:box-shadow .3s}
.service-card:hover{box-shadow:0 8px 24px rgba(0,0,0,.08)}
.service-card h3{font-size:1.15rem;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.service-card p{color:#64748b;line-height:1.6;font-size:.95rem}
.testimonials{padding:64px 0}
.test-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px}
.test-card p{color:#475569;line-height:1.7;font-style:italic;margin-bottom:16px}
.test-author{font-weight:700;font-size:.9rem}
.test-role{color:#94a3b8;font-size:.8rem}
.contact{background:#0f172a;padding:64px 0;color:#fff;text-align:center}
.contact h2{font-size:2rem;font-weight:700;margin-bottom:12px}
.contact p{color:#94a3b8;margin-bottom:32px}
.contact-btn{background:#dc2626;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;transition:background .2s}
.contact-btn:hover{background:#b91c1c}
.footer{padding:24px 0;text-align:center;color:#94a3b8;font-size:.8rem;background:#0f172a;border-top:1px solid rgba(255,255,255,.1)}
@media(max-width:768px){.hero-grid{grid-template-columns:1fr}.stats-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<nav class="nav"><div class="container"><div class="nav-inner">
<div class="logo">${escapeHtml(domainName)}</div>
<ul class="nav-links"><li><a href="#">Services</a></li><li><a href="#">About</a></li><li><a href="#">Reviews</a></li><li><a href="#">Contact</a></li></ul>
<a href="tel:+15551234567" class="phone">Call (555) 123-4567</a>
</div></div></nav>
<section class="hero"><div class="container"><div class="hero-grid">
<div><h1>Quality Service You Can Trust</h1><p>Serving our community with excellence for over 15 years. Professional, reliable, and always here when you need us.</p><a href="#" class="hero-btn">Get a Free Quote</a></div>
<div class="hero-img"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.5"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="6" x2="9" y2="6.01"/><line x1="15" y1="6" x2="15" y2="6.01"/><line x1="9" y1="10" x2="9" y2="10.01"/><line x1="15" y1="10" x2="15" y2="10.01"/><line x1="9" y1="14" x2="9" y2="14.01"/><line x1="15" y1="14" x2="15" y2="14.01"/><rect x="9" y="18" width="6" height="4"/></svg></div>
</div></div></section>
<section class="stats"><div class="container"><div class="stats-grid">
<div><div class="stat-num">15+</div><div class="stat-label">Years in Business</div></div>
<div><div class="stat-num">2,500+</div><div class="stat-label">Happy Clients</div></div>
<div><div class="stat-num">4.9</div><div class="stat-label">Star Rating</div></div>
<div><div class="stat-num">24/7</div><div class="stat-label">Support</div></div>
</div></div></section>
<section class="services"><div class="container">
<h2 class="section-title">Our Services</h2>
<p class="section-sub">Comprehensive solutions tailored to your needs</p>
<div class="grid-3">
<div class="service-card"><h3>Maintenance</h3><p>Regular maintenance and upkeep to keep everything running smoothly and prevent costly repairs.</p></div>
<div class="service-card"><h3>Repairs</h3><p>Fast, reliable repair services with a satisfaction guarantee. We fix it right the first time.</p></div>
<div class="service-card"><h3>Consultation</h3><p>Expert advice and planning to help you make informed decisions about your property or business.</p></div>
</div></div></section>
<section class="testimonials"><div class="container">
<h2 class="section-title">What Our Clients Say</h2>
<p class="section-sub">Real reviews from real customers</p>
<div class="grid-3">
<div class="test-card"><p>"Absolutely outstanding service. They went above and beyond what I expected. Highly recommend!"</p><div class="test-author">Sarah M.</div><div class="test-role">Homeowner</div></div>
<div class="test-card"><p>"Professional, punctual, and fair pricing. They've been our go-to service provider for years."</p><div class="test-author">James R.</div><div class="test-role">Business Owner</div></div>
<div class="test-card"><p>"Quick response time and excellent workmanship. Will definitely use them again for future projects."</p><div class="test-author">Maria L.</div><div class="test-role">Property Manager</div></div>
</div></div></section>
<section class="contact"><div class="container">
<h2>Ready to Get Started?</h2>
<p>Contact us today for a free consultation and quote.</p>
<a href="#" class="contact-btn">Request a Free Quote</a>
</div></section>
<footer class="footer"><div class="container"><p>${escapeHtml(domainName)} &bull; Built with SmartBeak SmartDeploy</p></div></footer>
</body></html>`;
}

function generateMediaNewsletter(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(domainName)} - Stories That Matter</title>
<meta name="description" content="${escapeHtml(domainName)} delivers the most important stories, analysis, and perspectives. Subscribe to our newsletter.">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1e293b;background:#fff}
.nav{border-bottom:1px solid #e2e8f0;padding:16px 0}
.container{max-width:1000px;margin:0 auto;padding:0 24px}
.nav-inner{display:flex;justify-content:space-between;align-items:center}
.logo{font-family:'Playfair Display',serif;font-weight:900;font-size:2rem;color:#7c3aed}
.nav-links{display:flex;gap:28px;list-style:none}
.nav-links a{color:#64748b;text-decoration:none;font-weight:500;font-size:.9rem;transition:color .2s}
.nav-links a:hover{color:#7c3aed}
.sub-btn{background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem;transition:background .2s}
.sub-btn:hover{background:#6d28d9}
.hero{padding:80px 0 60px;text-align:center;border-bottom:1px solid #e2e8f0}
.hero h1{font-family:'Playfair Display',serif;font-size:3.5rem;font-weight:900;line-height:1.15;margin-bottom:20px;max-width:700px;margin-left:auto;margin-right:auto}
.hero p{font-size:1.15rem;color:#64748b;line-height:1.7;max-width:500px;margin:0 auto 32px}
.hero-form{max-width:420px;margin:0 auto;display:flex;gap:12px}
.hero-form input{flex:1;padding:14px 18px;border:2px solid #e2e8f0;border-radius:10px;font-size:.95rem;font-family:inherit;transition:border .2s}
.hero-form input:focus{outline:none;border-color:#7c3aed}
.hero-form button{padding:14px 28px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .2s}
.hero-form button:hover{background:#6d28d9}
.hero-stats{display:flex;justify-content:center;gap:32px;margin-top:24px;color:#94a3b8;font-size:.875rem}
.hero-stats strong{color:#1e293b}
.featured{padding:56px 0;border-bottom:1px solid #e2e8f0}
.section-label{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.15em;color:#7c3aed;margin-bottom:24px}
.featured-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.feat-article{cursor:pointer;transition:transform .2s}
.feat-article:hover{transform:translateY(-2px)}
.feat-img{background:linear-gradient(135deg,#ede9fe,#ddd6fe);border-radius:12px;height:220px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;font-size:3rem}
.feat-category{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#7c3aed;margin-bottom:8px}
.feat-title{font-family:'Playfair Display',serif;font-size:1.5rem;font-weight:700;line-height:1.3;margin-bottom:8px}
.feat-excerpt{color:#64748b;font-size:.9rem;line-height:1.6}
.latest{padding:56px 0}
.latest-list{display:flex;flex-direction:column;gap:24px}
.latest-item{display:flex;gap:20px;padding-bottom:24px;border-bottom:1px solid #f1f5f9;align-items:flex-start}
.latest-num{font-family:'Playfair Display',serif;font-size:2rem;font-weight:900;color:#e2e8f0;min-width:40px}
.latest-item h3{font-size:1.1rem;font-weight:700;margin-bottom:4px;line-height:1.4}
.latest-item h3 a{color:#0f172a;text-decoration:none;transition:color .2s}
.latest-item h3 a:hover{color:#7c3aed}
.latest-item p{color:#64748b;font-size:.875rem;line-height:1.6}
.latest-meta{font-size:.75rem;color:#94a3b8;margin-top:6px}
.cta-bar{background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:48px;border-radius:16px;text-align:center;color:#fff;margin:48px 0}
.cta-bar h2{font-family:'Playfair Display',serif;font-size:2rem;font-weight:900;margin-bottom:12px}
.cta-bar p{opacity:.9;margin-bottom:24px}
.cta-bar a{background:#fff;color:#7c3aed;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;transition:transform .2s}
.cta-bar a:hover{transform:translateY(-1px)}
.footer{border-top:1px solid #e2e8f0;padding:32px 0;text-align:center;color:#94a3b8;font-size:.8rem}
@media(max-width:640px){.hero h1{font-size:2.25rem}.featured-grid{grid-template-columns:1fr}.hero-form{flex-direction:column}}
</style>
</head>
<body>
<nav class="nav"><div class="container"><div class="nav-inner">
<div class="logo">${escapeHtml(domainName)}</div>
<ul class="nav-links"><li><a href="#">Stories</a></li><li><a href="#">Topics</a></li><li><a href="#">Archive</a></li></ul>
<a href="#" class="sub-btn">Subscribe</a>
</div></div></nav>
<section class="hero"><div class="container">
<h1>Stories That Shape Our World</h1>
<p>In-depth reporting, thoughtful analysis, and perspectives that matter. Delivered free, every morning.</p>
<div class="hero-form"><input type="email" placeholder="you@email.com"><button>Subscribe Free</button></div>
<div class="hero-stats"><span><strong>25,000+</strong> subscribers</span><span><strong>Daily</strong> delivery</span><span><strong>5 min</strong> read</span></div>
</div></section>
<section class="featured"><div class="container">
<div class="section-label">Featured Stories</div>
<div class="featured-grid">
<div class="feat-article"><div class="feat-img"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="1.5"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/></svg></div><div class="feat-category">Technology</div><div class="feat-title">The Quiet Revolution Reshaping How We Work and Live</div><div class="feat-excerpt">How emerging technologies are creating new possibilities for communities worldwide.</div></div>
<div class="feat-article"><div class="feat-img"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div><div class="feat-category">Culture</div><div class="feat-title">Bridging Worlds: The New Global Creative Movement</div><div class="feat-excerpt">A look at the artists and thinkers connecting diverse traditions in unexpected ways.</div></div>
</div></div></section>
<section class="latest"><div class="container">
<div class="section-label">Latest</div>
<div class="latest-list">
<div class="latest-item"><div class="latest-num">01</div><div><h3><a href="#">Inside the Next Wave of Sustainable Innovation</a></h3><p>New approaches to old problems are emerging from unexpected places.</p><div class="latest-meta">5 min read &bull; Today</div></div></div>
<div class="latest-item"><div class="latest-num">02</div><div><h3><a href="#">The Data Behind the Headlines: What Numbers Really Tell Us</a></h3><p>Going beyond surface-level statistics to find the real story.</p><div class="latest-meta">7 min read &bull; Yesterday</div></div></div>
<div class="latest-item"><div class="latest-num">03</div><div><h3><a href="#">Conversations With Leaders: What Drives Change</a></h3><p>Exclusive interviews with the people shaping tomorrow's landscape.</p><div class="latest-meta">4 min read &bull; 2 days ago</div></div></div>
</div>
<div class="cta-bar"><h2>Never Miss a Story</h2><p>Join 25,000+ readers getting the best stories delivered to their inbox.</p><a href="#">Subscribe Now — It's Free</a></div>
</div></section>
<footer class="footer"><div class="container"><p>${escapeHtml(domainName)} &bull; Built with SmartBeak SmartDeploy</p></div></footer>
</body></html>`;
}

export function generateThemeHtml(theme: ThemeOption, domainName: string): string {
  switch (theme) {
    case "affiliate-comparison":
      return generateAffiliateComparison(domainName);
    case "authority-site":
      return generateAuthoritySite(domainName);
    case "landing-leadgen":
      return generateLandingLeadgen(domainName);
    case "local-business":
      return generateLocalBusiness(domainName);
    case "media-newsletter":
      return generateMediaNewsletter(domainName);
    default:
      return generateLandingLeadgen(domainName);
  }
}
