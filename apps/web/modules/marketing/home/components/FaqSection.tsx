"use client";

import { cn } from "@repo/ui";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@repo/ui/components/accordion";
import { useTranslations } from "next-intl";

export function FaqSection({ className }: { className?: string }) {
	const t = useTranslations();
	const items = t.raw("faq.items") as Array<{
		question: string;
		answer: string;
	}>;

	return (
		<section
			className={cn("scroll-mt-20 py-12 lg:py-16 xl:py-24", className)}
			id="faq"
		>
			<div className="container">
				<div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-6 md:gap-8 lg:gap-12">
					<div className="">
						<h1 className="mb-2 font-medium text-xl md:text-2xl lg:text-3xl xl:text-4xl leading-tighter text-foreground">
							{t("faq.title")}
						</h1>
						<p className="text-foreground/60 text-sm sm:text-lg">
							{t("faq.description")}
						</p>
					</div>
					<Accordion
						type="single"
						collapsible
						className="w-full space-y-2"
					>
						{items.map((item, i) => (
							<AccordionItem
								key={`faq-item-${i}`}
								value={`item-${i}`}
								className="rounded-lg bg-card shadow-none border px-4 lg:px-6"
							>
								<AccordionTrigger className="text-left font-medium text-base hover:no-underline">
									{item.question}
								</AccordionTrigger>
								<AccordionContent className="text-foreground/60">
									{item.answer}
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</div>
			</div>
		</section>
	);
}
