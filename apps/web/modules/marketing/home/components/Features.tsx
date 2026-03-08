import { cn } from "@repo/ui";
import {
	CloudIcon,
	ComputerIcon,
	SmartphoneIcon,
	StarIcon,
	WandIcon,
} from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import type { ComponentType, ReactNode } from "react";
import heroImage from "../../../../public/images/feature.svg";

export const featureTabs: Array<{
	id: string;
	title: string;
	icon: ComponentType<{ className?: string }>;
	subtitle?: string;
	description?: ReactNode;
	image?: StaticImageData;
	imageBorder?: boolean;
	stack?: {
		title: string;
		href: string;
		icon: ComponentType<{ className?: string }>;
	}[];
	highlights?: {
		title: string;
		description: string;
		icon: ComponentType<{
			className?: string;
			width?: string;
			height?: string;
		}>;
		demoLink?: string;
		docsLink?: string;
	}[];
}> = [
	{
		id: "feature1",
		title: "Portfolio operations",
		icon: StarIcon,
		subtitle: "Run domain workflows from one workspace.",
		description:
			"SmartBeak brings domain inventory, content, publishing status, SEO tracking, and readiness review into a single operator-facing workspace.",
		stack: [],
		image: heroImage,
		imageBorder: false,
		highlights: [
			{
				title: "Shared portfolio visibility",
				description:
					"See domains, content, analytics, and workflow state in one place instead of juggling disconnected tools.",
				icon: WandIcon,
			},
			{
				title: "Role-based access",
				description:
					"Use multi-tenant organization controls so teams can collaborate without exposing unrelated client or portfolio data.",
				icon: ComputerIcon,
			},
			{
				title: "Review-first diligence",
				description:
					"Track diligence categories and readiness signals with explicit operator review instead of relying on fabricated automation.",
				icon: SmartphoneIcon,
			},
		],
	},
	{
		id: "feature2",
		title: "Content and publishing",
		icon: CloudIcon,
		subtitle: "Create faster, publish carefully.",
		description:
			"Draft AI-assisted content, apply SEO guidance, and send work to the currently supported publishing targets while unsupported workflows stay clearly gated.",
		stack: [],
		image: heroImage,
		imageBorder: false,
		highlights: [
			{
				title: "AI-assisted drafting",
				description:
					"Generate ideas, outlines, and editing suggestions to speed up content creation without overstating what the system can publish automatically.",
				icon: WandIcon,
			},
			{
				title: "SEO guidance",
				description:
					"Track keywords, decay signals, and imported Search Console data while keeping limited provider support explicit.",
				icon: ComputerIcon,
			},
			{
				title: "Supported target controls",
				description:
					"Schedule and monitor jobs for supported targets, with retry controls and clear messaging where media or recipient workflows are not implemented.",
				icon: SmartphoneIcon,
			},
		],
	},
];

export function Features() {
	return (
		<section id="features" className="scroll-my-20 py-12 lg:py-16 xl:py-24">
			<div className="container">
				<div className="mb-6 lg:mb-0 max-w-3xl">
					<small className="font-medium text-xs uppercase tracking-wider text-primary mb-4 block">
						Platform overview
					</small>
					<h2 className="text-3xl lg:text-4xl xl:text-5xl font-medium">
						What SmartBeak is built to help with
					</h2>
					<p className="mt-2 text-base lg:text-lg text-foreground/60">
						This fallback marketing section now reflects real
						SmartBeak workflows instead of starter-template filler,
						so it can be safely reused if it is wired back into the
						site later.
					</p>
				</div>
			</div>

			<div>
				<div className="container mt-8 lg:mt-12 grid grid-cols-1 gap-8 md:gap-12 lg:gap-16 xl:gap-24">
					{featureTabs.map((tab) => {
						const filteredStack = tab.stack || [];
						const filteredHighlights = tab.highlights || [];
						return (
							<div key={tab.id} className="">
								<div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
									<div>
										{tab.image && (
											<Image
												src={tab.image}
												alt={tab.title}
												className={cn(
													" h-auto w-full max-w-xl",
													{
														"rounded-2xl border-4":
															tab.imageBorder,
													},
												)}
											/>
										)}
									</div>

									<div>
										<h3 className="font-normal text-lg text-foreground leading-tight md:text-xl lg:text-2xl">
											<span className="font-medium">
												{tab.title}.{" "}
											</span>
											<span className="font-sans">
												{tab.subtitle}
											</span>
										</h3>

										{tab.description && (
											<p className="mt-4 text-foreground/60">
												{tab.description}
											</p>
										)}

										{filteredStack?.length > 0 && (
											<div className="mt-4 flex flex-wrap gap-6">
												{filteredStack.map(
													(tool, k) => (
														<a
															href={tool.href}
															target="_blank"
															key={`stack-tool-${k}`}
															className="flex items-center gap-2"
															rel="noreferrer"
														>
															<tool.icon className="size-6" />
															<strong className="block text-sm">
																{tool.title}
															</strong>
														</a>
													),
												)}
											</div>
										)}
									</div>
								</div>

								{filteredHighlights.length > 0 && (
									<div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:mt-12">
										{filteredHighlights.map(
											(highlight, k) => (
												<div
													key={`highlight-${k}`}
													className="flex flex-col items-stretch justify-between rounded-2xl p-4 lg:p-6 bg-card"
												>
													<div>
														<highlight.icon
															className="text-primary text-xl"
															width="1em"
															height="1em"
														/>
														<strong className="mt-2 block font-medium text-lg">
															{highlight.title}
														</strong>
														<p className="mt-1 text-sm">
															{
																highlight.description
															}
														</p>
													</div>
												</div>
											),
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
