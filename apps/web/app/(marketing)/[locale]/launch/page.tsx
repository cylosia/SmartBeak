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
						Editable launch materials for Product Hunt, social
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
								&ldquo;What if you could run your domain
								portfolio from one workspace — drafting
								AI-assisted articles for supported publishing
								targets, tracking SEO decay signals, and
								reviewing sell-readiness estimates from one
								dashboard? That&apos;s SmartBeak.&rdquo;
							</p>

							<p>
								<strong>[0:15–0:45] Problem</strong>
								<br />
								&ldquo;Most domain portfolio owners juggle
								disconnected tools. Their domains sit idle,
								SEO decays, and when it&apos;s time to sell,
								they often lack organized diligence records and
								per-domain reporting. Managing content,
								publishing, and analytics across dozens of
								domains becomes operational overhead fast.&rdquo;
							</p>

							<p>
								<strong>[0:45–1:30] Demo — Dashboard</strong>
								<br />
								&ldquo;This is the SmartBeak dashboard. I can
								see all my domains, recorded metadata, SEO
								performance, and publishing status at a glance.
								Let me click into one domain...&rdquo;
							</p>

							<p>
								<strong>
									[1:30–2:00] Demo — AI Content + SEO
								</strong>
								<br />
								&ldquo;I&apos;ll hit the AI Ideas button.
								SmartBeak can generate structured content ideas
								with titles, outlines, estimated read times, and
								heuristic SEO scores. I can see the content
								optimizer rescore my draft as I type.&rdquo;
							</p>

							<p>
								<strong>
									[2:00–2:30] Demo — Publishing + Sell-Ready
								</strong>
								<br />
								&ldquo;One workflow schedules this article to go
								out on supported publishing targets from one
								calendar. And here&apos;s the sell-readiness
								estimate — SmartBeak combines recorded diligence
								data with portfolio signals to produce a
								heuristic score and highlight what to review
								next.&rdquo;
							</p>

							<p>
								<strong>[2:30–3:00] CTA</strong>
								<br />
								&ldquo;SmartBeak is in early access. Join the
								waitlist at smartbeak.io for staged beta access
								updates. I&apos;ll see you inside.&rdquo;
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
								template: `🚀 Introducing SmartBeak — an AI-assisted content operations workspace for domain portfolio owners.

• Publish to supported targets from one dashboard
• AI content ideas with responsive SEO scoring  
• Diligence review workflows + sell-readiness estimate
• Keyword decay signals before they hurt rankings

Join the waitlist → smartbeak.io/waitlist

#domaining #SEO #contentmarketing #SaaS`,
							},
							{
								platform: "LinkedIn",
								template: `After months of building, I'm excited to announce SmartBeak — an AI-assisted workspace for domain portfolio owners.

The problem: managing content, SEO, and publishing across dozens of domains is exhausting. Most portfolio owners end up juggling disconnected tools and fragmented reporting.

SmartBeak solves this with:

✅ AI content idea generator (titles, outlines, heuristic SEO scores)
✅ Content optimizer with responsive SEO scoring
✅ Supported publishing targets from one shared calendar
✅ Keyword tracking with decay signals
✅ Diligence review workflows with sell-readiness estimates
✅ Portfolio ROI Dashboard with buyer attribution

We're opening staged beta access to a small group of early users.

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
								template: `SmartBeak is a multi-tenant workspace for domain portfolio owners.

🧠 AI Content: Generate ideas, outlines, and heuristic SEO scores. The content optimizer rescoring updates as you edit.

📡 Supported Publishing Platforms: LinkedIn, Facebook, Pinterest, WordPress, and SoundCloud from one calendar, with additional adapters gated until their media workflows are implemented safely.

📊 SEO Intelligence: Keyword tracking with decay signals, Google Search Console imports, and manual or imported provider data where available.

💼 Portfolio Analytics: Risk-adjusted portfolio scoring, manual diligence review support, sell-readiness estimates, and buyer attribution.

🔒 Platform controls: Multi-tenant RBAC, immutable audit log, RLS via Supabase, Stripe billing, and feature flags.

Built on Supastarter Pro + Supabase + Vercel. Locked v9 schema with staged beta rollout.`,
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
								Subject: SmartBeak beta access update
							</p>
						</div>
						<div className="p-6 text-sm text-foreground/70 leading-relaxed space-y-4">
							<p>Hi [First Name],</p>
							<p>
								You&apos;re on the SmartBeak waitlist — and
								we&apos;re opening limited beta access in
								stages.
							</p>
							<p>
								SmartBeak is an AI-assisted content operations
								workspace built specifically for domain
								portfolio owners like you. Here&apos;s what you
								get from day one:
							</p>
							<ul className="list-disc list-inside space-y-1 ml-2">
								<li>
									AI content ideas with titles, outlines, and
									heuristic SEO scores
								</li>
								<li>
									Content optimizer with responsive scoring as
									you type
								</li>
								<li>
									Supported publishing targets from one
									calendar
								</li>
								<li>Keyword tracking with decay signals</li>
								<li>
									Diligence review workflows +
									sell-readiness estimates
								</li>
								<li>
									Portfolio ROI dashboard with buyer
									attribution
								</li>
							</ul>
							<p>
								We&apos;ll share rollout details, onboarding
								steps, and any future commercial terms directly
								with approved beta users.
							</p>
							<p>
								<strong>
									→ View beta access details: [CTA BUTTON]
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
								"Configure optional provider credentials needed for your planned SEO imports",
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
