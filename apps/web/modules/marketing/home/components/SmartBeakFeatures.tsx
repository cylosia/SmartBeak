import {
	BarChart3Icon,
	CalendarIcon,
	CreditCardIcon,
	GlobeIcon,
	ImageIcon,
	PenToolIcon,
	RocketIcon,
	SearchIcon,
	SendIcon,
	ShieldIcon,
	SparklesIcon,
	TrendingUpIcon,
} from "lucide-react";

const FEATURES = [
	{
		icon: GlobeIcon,
		title: "Domain Management",
		description:
			"Manage unlimited domains with recorded registry metadata, health snapshots, deployment status, and full RBAC with owner/admin/editor/viewer roles.",
		color: "text-blue-500 dark:text-blue-400",
		bg: "bg-blue-500/10",
	},
	{
		icon: SparklesIcon,
		title: "AI Content Editor",
		description:
			"Rich Tiptap editor with revision history, AI idea generation, and real-time SEO scoring as you type. Powered by the Vercel AI SDK.",
		color: "text-violet-500 dark:text-violet-400",
		bg: "bg-violet-500/10",
	},
	{
		icon: SendIcon,
		title: "Supported Publishing Platforms",
		description:
			"Publish to supported platforms such as LinkedIn, Facebook, Pinterest, WordPress, and SoundCloud from one place.",
		color: "text-pink-500 dark:text-pink-400",
		bg: "bg-pink-500/10",
	},
	{
		icon: SearchIcon,
		title: "SEO Intelligence",
		description:
			"Keyword tracking with volume, difficulty, position, and decay signals. Google Search Console imports are available, while broader provider automation remains limited.",
		color: "text-green-500 dark:text-green-400",
		bg: "bg-green-500/10",
	},
	{
		icon: BarChart3Icon,
		title: "Portfolio ROI Dashboard",
		description:
			"Risk-adjusted scoring, total portfolio score, performance trends, and buyer attribution tracking. Materialized views support faster dashboard queries.",
		color: "text-orange-500 dark:text-orange-400",
		bg: "bg-orange-500/10",
	},
	{
		icon: TrendingUpIcon,
		title: "Diligence Engine",
		description:
			"Structured diligence review across ownership, legal, financial, and content categories, with sell-readiness guidance based on recorded review data.",
		color: "text-cyan-500 dark:text-cyan-400",
		bg: "bg-cyan-500/10",
	},
	{
		icon: CalendarIcon,
		title: "Bulk Scheduling",
		description:
			"Drag-and-drop calendar view for scheduling content across supported publishing targets, with bulk scheduling and live job status tracking.",
		color: "text-indigo-500 dark:text-indigo-400",
		bg: "bg-indigo-500/10",
	},
	{
		icon: ImageIcon,
		title: "Media Library",
		description:
			"Upload, organise, and reuse media assets across your domains, with secure storage, preview, copy-link, and deletion workflows.",
		color: "text-rose-500 dark:text-rose-400",
		bg: "bg-rose-500/10",
	},
	{
		icon: ShieldIcon,
		title: "Immutable Audit Log",
		description:
			"Every action is recorded in an append-only audit trail with actor, timestamp, and change details where available.",
		color: "text-slate-500 dark:text-slate-400",
		bg: "bg-slate-500/10",
	},
	{
		icon: CreditCardIcon,
		title: "Billing & Usage Quotas",
		description:
			"Stripe-powered subscriptions with per-org usage meters, monetisation decay signals, and plan enforcement at the API layer.",
		color: "text-emerald-500 dark:text-emerald-400",
		bg: "bg-emerald-500/10",
	},
	{
		icon: RocketIcon,
		title: "SmartDeploy",
		description:
			"Deploy supported theme builds to Vercel when SmartDeploy is configured for the current environment.",
		color: "text-yellow-500 dark:text-yellow-400",
		bg: "bg-yellow-500/10",
	},
	{
		icon: PenToolIcon,
		title: "Email Series Builder",
		description:
			"Planned drip campaign builder surface. Multi-step email automation is not generally available in the current publishing queue yet.",
		color: "text-teal-500 dark:text-teal-400",
		bg: "bg-teal-500/10",
	},
];

export function SmartBeakFeatures() {
	return (
		<section id="features" className="py-16 lg:py-24 xl:py-32 scroll-mt-16">
			<div className="container max-w-6xl">
				{/* Header */}
				<div className="max-w-2xl mb-12">
					<h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl leading-tight">
						Everything you need to{" "}
						<span className="text-primary">
							dominate your niche
						</span>
					</h2>
					<p className="mt-4 text-lg text-foreground/60 leading-relaxed">
						SmartBeak gives domain portfolio owners one workspace for
						content creation, supported publishing flows, SEO,
						analytics, and sell-readiness review.
					</p>
				</div>

				{/* Feature grid */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{FEATURES.map(
						({ icon: Icon, title, description, color, bg }) => (
							<div
								key={title}
								className="group relative rounded-2xl border border-border/50 bg-card p-6 hover:border-primary/30 hover:shadow-lg transition-all duration-200"
							>
								<div
									className={`inline-flex size-10 items-center justify-center rounded-xl ${bg} mb-4`}
								>
									<Icon className={`size-5 ${color}`} />
								</div>
								<h3 className="font-semibold text-foreground text-base mb-2">
									{title}
								</h3>
								<p className="text-sm text-foreground/60 leading-relaxed">
									{description}
								</p>
							</div>
						),
					)}
				</div>
			</div>
		</section>
	);
}
