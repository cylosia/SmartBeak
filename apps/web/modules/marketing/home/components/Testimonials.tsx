const TESTIMONIALS = [
	{
		quote: "SmartBeak completely changed how I manage my 40-domain portfolio. The Diligence Engine alone saved me weeks of manual due diligence before my last exit.",
		author: "Marcus T.",
		role: "Domain Portfolio Investor",
		avatar: "MT",
		rating: 5,
	},
	{
		quote: "The AI content idea generator is genuinely impressive. I went from zero content to 3 months of scheduled posts across 8 platforms in a single afternoon.",
		author: "Priya S.",
		role: "Content Entrepreneur",
		avatar: "PS",
		rating: 5,
	},
	{
		quote: "The SEO decay signals feature is a game-changer. I caught a keyword that was about to drop off page 1 and published a refresh article — traffic recovered in 2 weeks.",
		author: "James K.",
		role: "Niche Site Builder",
		avatar: "JK",
		rating: 5,
	},
	{
		quote: "Finally a SaaS that treats domain portfolio management as a serious business. The Portfolio ROI dashboard is exactly what I needed to pitch to buyers.",
		author: "Elena V.",
		role: "Digital Asset Broker",
		avatar: "EV",
		rating: 5,
	},
	{
		quote: "The multi-tenant RBAC is perfect for my agency. I can give clients viewer access to their own domains without them seeing anything else.",
		author: "David L.",
		role: "Digital Agency Owner",
		avatar: "DL",
		rating: 5,
	},
	{
		quote: "Publishing to LinkedIn, TikTok, and email all from one place is incredible. The calendar view makes it easy to see what's going out when.",
		author: "Sophia R.",
		role: "Content Creator",
		avatar: "SR",
		rating: 5,
	},
];

function StarRating({ rating }: { rating: number }) {
	return (
		<div className="flex gap-0.5">
			{Array.from({ length: 5 }).map((_, i) => (
				<svg
					key={i}
					className={`size-4 ${i < rating ? "text-yellow-400" : "text-muted"}`}
					fill="currentColor"
					viewBox="0 0 20 20"
					aria-hidden="true"
				>
					<title>{i < rating ? "Filled star" : "Empty star"}</title>
					<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
				</svg>
			))}
		</div>
	);
}

export function Testimonials() {
	return (
		<section className="py-16 lg:py-24 bg-muted/30">
			<div className="container max-w-6xl">
				<div className="text-center max-w-2xl mx-auto mb-12">
					<h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl leading-tight">
						Loved by domain portfolio owners
					</h2>
					<p className="mt-4 text-lg text-foreground/60">
						Join hundreds of investors, builders, and content
						entrepreneurs who use SmartBeak to grow and exit their
						portfolios.
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{TESTIMONIALS.map(
						({ quote, author, role, avatar, rating }) => (
							<div
								key={author}
								className="rounded-2xl border border-border/50 bg-card p-6 flex flex-col gap-4"
							>
								<StarRating rating={rating} />
								<blockquote className="text-sm text-foreground/70 leading-relaxed flex-1">
									&ldquo;{quote}&rdquo;
								</blockquote>
								<div className="flex items-center gap-3 pt-2 border-t border-border/30">
									<div className="size-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs">
										{avatar}
									</div>
									<div>
										<div className="text-sm font-semibold text-foreground">
											{author}
										</div>
										<div className="text-xs text-foreground/50">
											{role}
										</div>
									</div>
								</div>
							</div>
						),
					)}
				</div>
			</div>
		</section>
	);
}
