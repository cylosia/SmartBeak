import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Launch Assets — SmartBeak",
	description:
		"SmartBeak launch assets: Loom video script, social media cards, and announcement templates.",
};

export default function LaunchAssetsPage() {
	return (
		<main className="py-16 lg:py-24">
			<div className="container max-w-4xl space-y-16">
				{/* Header */}
				<div>
					<h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
						SmartBeak Launch Assets
					</h1>
					<p className="mt-4 text-lg text-foreground/60">
						Ready-to-use launch materials for Product Hunt, social
						media, and email announcements.
					</p>
				</div>

				{/* Loom Video Script */}
				<section className="space-y-4">
					<h2 className="text-2xl font-bold text-foreground">
						Loom Video Script
					</h2>
					<div className="rounded-2xl border border-border/50 bg-card p-8 space-y-4 text-sm text-foreground/80 leading-relaxed">
						<p className="font-semibold text-foreground text-base">
							Duration: ~3 minutes
						</p>
						<div className="space-y-3">
							<p>
								<strong>[0:00–0:15] Hook</strong>
								<br />
								&ldquo;What if you could turn your entire domain
								portfolio into a content machine — publishing
								AI-generated articles across 11 platforms,
								tracking SEO decay before it costs you rankings,
								and knowing exactly when your domain is
								sell-ready? That&apos;s SmartBeak.&rdquo;
							</p>

							<p>
								<strong>[0:15–0:45] Problem</strong>
								<br />
								&ldquo;Most domain portfolio owners are leaving
								money on the table. Their domains sit idle,
								their SEO decays, and when it&apos;s time to
								sell, they have no data to back up their asking
								price. Managing content, publishing, and
								analytics across dozens of domains is a
								full-time job — until now.&rdquo;
							</p>

							<p>
								<strong>[0:45–1:30] Demo — Dashboard</strong>
								<br />
								&ldquo;This is the SmartBeak dashboard. I can
								see all my domains, their health scores, SEO
								performance, and publishing status at a glance.
								Let me click into one domain...&rdquo;
							</p>

							<p>
								<strong>
									[1:30–2:00] Demo — AI Content + SEO
								</strong>
								<br />
								&ldquo;I&apos;ll hit the AI Ideas button.
								SmartBeak generates 5 structured content ideas
								with titles, outlines, estimated read times, and
								SEO scores — all in about 3 seconds. I can see
								the real-time content optimizer scoring my draft
								as I type.&rdquo;
							</p>

							<p>
								<strong>
									[2:00–2:30] Demo — Publishing + Sell-Ready
								</strong>
								<br />
								&ldquo;One click schedules this article to go
								out on LinkedIn, email, and the web
								simultaneously. And here&apos;s the Sell-Ready
								score — SmartBeak&apos;s Diligence Engine has
								checked ownership, legal, financial, and content
								signals and given this domain an 84/100 with
								specific recommendations to hit 95.&rdquo;
							</p>

							<p>
								<strong>[2:30–3:00] CTA</strong>
								<br />
								&ldquo;SmartBeak is in early access. Join the
								waitlist at smartbeak.io and lock in founding
								member pricing — 40% off for life. I&apos;ll see
								you inside.&rdquo;
							</p>
						</div>
					</div>
				</section>

				{/* Social Media Cards */}
				<section className="space-y-4">
					<h2 className="text-2xl font-bold text-foreground">
						Social Media Announcement Templates
					</h2>
					<div className="space-y-4">
						{[
							{
								platform: "X (Twitter)",
								template: `🚀 Introducing SmartBeak — the AI-powered content publishing platform for domain portfolio owners.

• Publish to 11 platforms from one dashboard
• AI content ideas with real-time SEO scoring  
• Diligence Engine + Sell-Ready score
• Keyword decay signals before they hurt rankings

Join the waitlist → smartbeak.io/waitlist

#domaining #SEO #contentmarketing #SaaS`,
							},
							{
								platform: "LinkedIn",
								template: `After months of building, I'm excited to announce SmartBeak — a premium AI-powered SaaS for domain portfolio owners.

The problem: managing content, SEO, and publishing across dozens of domains is exhausting. Most portfolio owners are leaving significant value on the table.

SmartBeak solves this with:

✅ AI content idea generator (title, outline, SEO score in seconds)
✅ Real-time content optimizer with live SEO scoring
✅ 11-platform publishing (LinkedIn, YouTube, TikTok, Instagram, and more)
✅ Keyword tracking with decay signals
✅ Diligence Engine with automated Sell-Ready scoring
✅ Portfolio ROI Dashboard with buyer attribution

We're opening early access to a small group of founding members who will lock in 40% off for life.

If you manage domain portfolios, build niche sites, or work in digital asset brokerage — this was built for you.

Join the waitlist: smartbeak.io/waitlist`,
							},
							{
								platform: "Product Hunt Tagline",
								template:
									"SmartBeak — AI-powered content publishing & portfolio intelligence for domain owners",
							},
							{
								platform: "Product Hunt Description",
								template: `SmartBeak is the premium multi-tenant SaaS for serious domain portfolio owners.

🧠 AI Content: Generate ideas, outlines, and SEO scores in seconds. Real-time optimizer scores your content as you type.

📡 11-Platform Publishing: Web, Email (Resend), LinkedIn, YouTube, TikTok, Instagram, Pinterest, Vimeo, Facebook, WordPress, SoundCloud — all from one calendar.

📊 SEO Intelligence: Keyword tracking with decay signals, GSC + Ahrefs integration, automated daily reports.

💼 Portfolio Analytics: Risk-adjusted ROI scoring, Diligence Engine (ownership/legal/financial checks), one-click Sell-Ready score, buyer attribution.

🔒 Enterprise-grade: Multi-tenant RBAC, immutable audit log, RLS via Supabase, Stripe billing, feature flags.

Built on Supastarter Pro + Supabase + Vercel. Locked v9 schema. Production-ready from day one.`,
							},
						].map(({ platform, template }) => (
							<div
								key={platform}
								className="rounded-2xl border border-border/50 bg-card overflow-hidden"
							>
								<div className="flex items-center justify-between px-6 py-3 border-b border-border/30 bg-muted/30">
									<span className="text-sm font-semibold text-foreground">
										{platform}
									</span>
								</div>
								<pre className="p-6 text-sm text-foreground/70 whitespace-pre-wrap font-sans leading-relaxed">
									{template}
								</pre>
							</div>
						))}
					</div>
				</section>

				{/* Email Announcement */}
				<section className="space-y-4">
					<h2 className="text-2xl font-bold text-foreground">
						Email Announcement Template
					</h2>
					<div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
						<div className="px-6 py-3 border-b border-border/30 bg-muted/30">
							<p className="text-sm font-semibold text-foreground">
								Subject: SmartBeak is live — your early access
								is ready
							</p>
						</div>
						<div className="p-6 text-sm text-foreground/70 leading-relaxed space-y-4">
							<p>Hi [First Name],</p>
							<p>
								You&apos;re on the SmartBeak waitlist — and
								today, your early access is ready.
							</p>
							<p>
								SmartBeak is the AI-powered content publishing
								platform I built specifically for domain
								portfolio owners like you. Here&apos;s what you
								get from day one:
							</p>
							<ul className="list-disc list-inside space-y-1 ml-2">
								<li>
									AI content ideas with titles, outlines, and
									SEO scores
								</li>
								<li>
									Real-time content optimizer (live scoring as
									you type)
								</li>
								<li>
									11-platform publishing from one calendar
								</li>
								<li>Keyword tracking with decay signals</li>
								<li>Diligence Engine + Sell-Ready score</li>
								<li>
									Portfolio ROI dashboard with buyer
									attribution
								</li>
							</ul>
							<p>
								As a founding member, you&apos;re locked in at{" "}
								<strong>40% off</strong> for as long as you stay
								subscribed.
							</p>
							<p>
								<strong>
									→ Activate your account: [CTA BUTTON]
								</strong>
							</p>
							<p>
								If you have any questions, just reply to this
								email — I read every one.
							</p>
							<p>
								Welcome to SmartBeak.
								<br />— The SmartBeak Team
							</p>
						</div>
					</div>
				</section>

				{/* Launch Checklist */}
				<section className="space-y-4">
					<h2 className="text-2xl font-bold text-foreground">
						Launch Checklist
					</h2>
					<div className="rounded-2xl border border-border/50 bg-card p-6">
						<div className="space-y-3">
							{[
								"Set up Supabase project and run `pnpm drizzle:push`",
								"Configure Stripe products and price IDs in `packages/payments/config.ts`",
								"Set up Resend domain and API key in `.env.local`",
								"Configure OpenAI API key for AI features",
								"Set up S3/R2 bucket for media storage",
								"Configure GSC OAuth credentials for SEO sync",
								"Configure Ahrefs API key for keyword data",
								"Deploy to Vercel with all environment variables",
								"Run `pnpm drizzle:push` against production Supabase",
								"Record Loom demo video using the script above",
								"Schedule Product Hunt launch (Tuesday–Thursday, 12:01 AM PT)",
								"Queue social media posts using the templates above",
								"Send waitlist announcement email",
								"Post in relevant communities (Indie Hackers, Domain Forum, etc.)",
							].map((item, i) => (
								<div
									key={i}
									className="flex items-start gap-3 text-sm text-foreground/70"
								>
									<div className="size-5 rounded border border-border/50 shrink-0 mt-0.5" />
									<span>{item}</span>
								</div>
							))}
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}
