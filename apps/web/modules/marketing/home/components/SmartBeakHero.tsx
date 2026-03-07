import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
	ArrowRightIcon,
	ShieldCheckIcon,
	SparklesIcon,
	TrendingUpIcon,
	ZapIcon,
} from "lucide-react";
import Link from "next/link";

const STATS = [
	{ value: "26", label: "Schema tables" },
	{ value: "11", label: "Platform adapters" },
	{ value: "8+", label: "AI modules" },
	{ value: "∞", label: "Domains supported" },
];

const TRUST_BADGES = [
	{ icon: ShieldCheckIcon, label: "SOC 2 Ready" },
	{ icon: ZapIcon, label: "< 200ms API" },
	{ icon: TrendingUpIcon, label: "99.9% uptime" },
	{ icon: SparklesIcon, label: "AI-native" },
];

export function SmartBeakHero() {
	return (
		<section className="relative overflow-hidden bg-background pt-20 pb-16 lg:pt-32 lg:pb-24">
			{/* Background gradient */}
			<div className="pointer-events-none absolute inset-0 -z-10">
				<div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-primary/5 blur-3xl" />
				<div className="absolute right-0 top-1/4 h-[400px] w-[400px] rounded-full bg-violet-500/5 blur-3xl" />
			</div>

			<div className="container max-w-6xl">
				{/* Eyebrow */}
				<div className="flex justify-center mb-6">
					<Badge
						status="info"
						className="gap-1.5 border border-primary/30"
					>
						<SparklesIcon className="size-3" />
						AI-Powered Content Publishing Platform
					</Badge>
				</div>

				{/* Headline */}
				<div className="text-center max-w-4xl mx-auto">
					<h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.1]">
						Turn your domain portfolio into a{" "}
						<span className="text-primary">revenue engine</span>
					</h1>
					<p className="mt-6 text-lg text-foreground/60 sm:text-xl max-w-2xl mx-auto leading-relaxed">
						SmartBeak is the premium multi-tenant SaaS for serious
						domain portfolio owners. Publish AI-generated content
						across 11 platforms, track SEO decay signals, and
						maximise your sell-ready score — all from one dashboard.
					</p>
				</div>

				{/* CTA Buttons */}
				<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
					<Button
						size="lg"
						asChild
						className="gap-2 px-8 h-12 text-base"
					>
						<Link href="/waitlist">
							Join the Waitlist
							<ArrowRightIcon className="size-4" />
						</Link>
					</Button>
					<Button
						size="lg"
						variant="outline"
						asChild
						className="gap-2 px-8 h-12 text-base"
					>
						<Link href="#features">See Features</Link>
					</Button>
				</div>

				{/* Trust badges */}
				<div className="mt-12 flex flex-wrap items-center justify-center gap-6">
					{TRUST_BADGES.map(({ icon: Icon, label }) => (
						<div
							key={label}
							className="flex items-center gap-2 text-sm text-foreground/50"
						>
							<Icon className="size-4 text-primary/60" />
							<span>{label}</span>
						</div>
					))}
				</div>

				{/* Stats */}
				<div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-2xl mx-auto">
					{STATS.map(({ value, label }) => (
						<div key={label} className="text-center">
							<div className="text-3xl font-bold text-foreground">
								{value}
							</div>
							<div className="mt-1 text-sm text-foreground/50">
								{label}
							</div>
						</div>
					))}
				</div>

				{/* Dashboard preview mockup */}
				<div className="mt-16 relative mx-auto max-w-5xl">
					<div className="rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden">
						{/* Window chrome */}
						<div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
							<div className="size-3 rounded-full bg-red-400/70" />
							<div className="size-3 rounded-full bg-yellow-400/70" />
							<div className="size-3 rounded-full bg-green-400/70" />
							<div className="ml-4 flex-1 h-6 rounded bg-muted/50 max-w-xs" />
						</div>
						{/* Mock dashboard content */}
						<div className="p-6 grid grid-cols-4 gap-4">
							{/* Sidebar mock */}
							<div className="col-span-1 space-y-2">
								{[
									"Dashboard",
									"Domains",
									"Content",
									"Publishing",
									"SEO",
									"Analytics",
									"Billing",
								].map((item, i) => (
									<div
										key={item}
										className={`h-8 rounded-lg flex items-center px-3 text-xs font-medium ${
											i === 0
												? "bg-primary/10 text-primary"
												: "text-foreground/40"
										}`}
									>
										{item}
									</div>
								))}
							</div>
							{/* Main content mock */}
							<div className="col-span-3 space-y-4">
								<div className="grid grid-cols-3 gap-3">
									{[
										{
											label: "Total Domains",
											value: "24",
											textColor:
												"text-blue-600 dark:text-blue-400",
										},
										{
											label: "Avg SEO Score",
											value: "78",
											textColor:
												"text-green-600 dark:text-green-400",
										},
										{
											label: "Sell-Ready",
											value: "12",
											textColor:
												"text-violet-600 dark:text-violet-400",
										},
									].map(({ label, value, textColor }) => (
										<div
											key={label}
											className="rounded-xl border border-border/50 bg-card p-4"
										>
											<div className="text-xs text-foreground/50">
												{label}
											</div>
											<div
												className={`text-2xl font-bold mt-1 ${textColor}`}
											>
												{value}
											</div>
										</div>
									))}
								</div>
								{/* Chart mock */}
								<div className="rounded-xl border border-border/50 bg-card p-4 h-32 flex items-end gap-1">
									{[
										40, 65, 45, 80, 55, 90, 70, 85, 60, 95,
										75, 88,
									].map((h, i) => (
										<div
											key={i}
											className="flex-1 rounded-t bg-primary/20"
											style={{ height: `${h}%` }}
										/>
									))}
								</div>
								{/* Table mock */}
								<div className="rounded-xl border border-border/50 bg-card overflow-hidden">
									{[
										"example.com",
										"mybrand.io",
										"portfolio.net",
									].map((domain, i) => (
										<div
											key={domain}
											className={`flex items-center justify-between px-4 py-2.5 text-xs ${i > 0 ? "border-t border-border/30" : ""}`}
										>
											<span className="text-foreground/70 font-medium">
												{domain}
											</span>
											<div className="flex items-center gap-3">
												<div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
													<div
														className="h-full bg-primary/60 rounded-full"
														style={{
															width: `${[78, 65, 92][i] ?? 78}%`,
														}}
													/>
												</div>
												<span
													className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
														i === 2
															? "bg-green-500/10 text-green-600 dark:text-green-400"
															: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
													}`}
												>
													{i === 2
														? "Active"
														: "Pending"}
												</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
					{/* Glow under the mockup */}
					<div className="absolute -bottom-6 left-1/2 -translate-x-1/2 h-12 w-3/4 bg-primary/10 blur-2xl rounded-full" />
				</div>
			</div>
		</section>
	);
}
