const USE_CASES = [
	{
		title: "Domain portfolio operators",
		description:
			"Track domain health, publishing status, SEO signals, and readiness indicators across a shared portfolio workspace.",
	},
	{
		title: "Content teams",
		description:
			"Draft AI-assisted content, review SEO guidance, and coordinate supported publishing workflows from one place.",
	},
	{
		title: "SEO-focused builders",
		description:
			"Monitor keyword movement, decay signals, and imported Search Console data while broader provider automation remains limited.",
	},
	{
		title: "Digital asset brokers",
		description:
			"Review portfolio analytics, captured buyer-session data, and diligence notes before sharing domains with buyers.",
	},
	{
		title: "Agencies and client teams",
		description:
			"Use multi-tenant RBAC to separate organizations, domains, and operator access without exposing unrelated client data.",
	},
	{
		title: "Beta evaluators",
		description:
			"Explore the current SmartBeak beta surfaces, supported targets, and staged rollout workflow before general availability.",
	},
];

export function Testimonials() {
	return (
		<section className="py-16 lg:py-24 bg-muted/30">
			<div className="container max-w-6xl">
				<div className="text-center max-w-2xl mx-auto mb-12">
					<h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl leading-tight">
						Built for teams like these
					</h2>
					<p className="mt-4 text-lg text-foreground/60">
						SmartBeak is in staged beta access. These are the
						operator groups the current platform is designed to
						support.
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{USE_CASES.map(({ title, description }) => (
							<div
								key={title}
								className="rounded-2xl border border-border/50 bg-card p-6 flex flex-col gap-4"
							>
								<div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs">
									{title
										.split(" ")
										.map((word) => word[0])
										.join("")
										.slice(0, 2)}
								</div>
								<div className="space-y-2">
									<div className="text-sm font-semibold text-foreground">
										{title}
									</div>
									<p className="text-sm text-foreground/70 leading-relaxed">
										{description}
									</p>
								</div>
							</div>
						))}
				</div>
			</div>
		</section>
	);
}
