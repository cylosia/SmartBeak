"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowRightIcon,
	CheckCircleIcon,
	GiftIcon,
	UsersIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

const formSchema = z.object({
	email: z.string().email("Please enter a valid email address"),
	firstName: z.string().max(100).optional(),
	company: z.string().max(200).optional(),
});

type FormData = z.infer<typeof formSchema>;

interface WaitlistResult {
	success: boolean;
	alreadyJoined: boolean;
	referralCode: string;
	referralLink: string;
	position: number | null;
}

export function WaitlistSection() {
	const searchParams = useSearchParams();
	const referredBy = searchParams.get("ref") ?? undefined;
	const [result, setResult] = useState<WaitlistResult | null>(null);
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => () => clearTimeout(copyTimerRef.current), []);

	const joinMutation = useMutation(
		orpc.smartbeak.growth.joinWaitlist.mutationOptions(),
	);
	const canCopyReferralLink =
		typeof navigator !== "undefined" &&
		typeof navigator.clipboard?.writeText === "function" &&
		Boolean(result?.referralLink);

	const form = useForm<FormData>({
		resolver: zodResolver(formSchema),
		defaultValues: { email: "", firstName: "", company: "" },
	});

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const res = await joinMutation.mutateAsync({ ...data, referredBy });
			setResult(res as WaitlistResult);
		} catch {
			form.setError("email", {
				message: "Something went wrong. Please try again.",
			});
		}
	});

	const copyReferralLink = async () => {
		if (!result?.referralLink || !canCopyReferralLink) {
			return;
		}

		try {
			await navigator.clipboard.writeText(result.referralLink);
			setCopied(true);
			clearTimeout(copyTimerRef.current);
			copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	};

	return (
		<section id="waitlist" className="py-16 lg:py-24 xl:py-32 scroll-mt-16">
			<div className="container max-w-2xl">
				<div className="rounded-3xl border border-border/50 bg-card p-8 lg:p-12 shadow-xl">
					{!result ? (
						<>
							{/* Header */}
							<div className="text-center mb-8">
								<div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
									<UsersIcon className="size-7 text-primary" />
								</div>
								<h2 className="text-2xl font-bold text-foreground sm:text-3xl">
									Join the SmartBeak waitlist
								</h2>
								<p className="mt-3 text-foreground/60">
									Get early access to the AI-powered content
									publishing platform built for serious domain
									portfolio owners.
									{referredBy && (
										<span className="block mt-2 text-primary font-medium">
											🎉 You were referred — you&apos;ll
											get priority access!
										</span>
									)}
								</p>
							</div>

							{/* Perks */}
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
								{[
									{ icon: "🚀", label: "Early access" },
									{ icon: "🗂️", label: "Beta rollout updates" },
									{ icon: "🎁", label: "Referral priority" },
								].map(({ icon, label }) => (
									<div
										key={label}
										className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium text-foreground/70"
									>
										<span>{icon}</span>
										{label}
									</div>
								))}
							</div>

							{/* Form */}
							<form onSubmit={onSubmit} className="space-y-4">
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<Input
											placeholder="First name"
											{...form.register("firstName")}
										/>
									</div>
									<div>
										<Input
											placeholder="Company (optional)"
											{...form.register("company")}
										/>
									</div>
								</div>
								<div>
									<Input
										type="email"
										required
										placeholder="your@email.com"
										{...form.register("email")}
									/>
									{form.formState.errors.email && (
										<p className="mt-1 text-destructive text-xs">
											{
												form.formState.errors.email
													.message
											}
										</p>
									)}
								</div>
								<Button
									type="submit"
									className="w-full gap-2 h-12 text-base"
									loading={form.formState.isSubmitting}
								>
									Request Early Access
									<ArrowRightIcon className="size-4" />
								</Button>
							</form>

							<p className="mt-4 text-center text-xs text-foreground/40">
								No spam. Unsubscribe anytime. We respect your
								privacy.
							</p>
						</>
					) : (
						/* Success state */
						<div className="text-center space-y-6">
							<div className="inline-flex size-16 items-center justify-center rounded-2xl bg-green-500/10 mb-2">
								<CheckCircleIcon className="size-8 text-green-500" />
							</div>
							<div>
								<h3 className="text-2xl font-bold text-foreground">
									{result.alreadyJoined
										? "You're already on the list!"
										: "You're on the list! 🎉"}
								</h3>
								<p className="mt-2 text-foreground/60">
									{result.alreadyJoined
										? "We already have your email. Here's your referral link to move up the queue."
										: "We'll notify you as staged beta access expands. In the meantime, share your referral link to move up the queue."}
								</p>
							</div>

							{/* Referral link */}
							<div className="rounded-2xl border border-border/50 bg-muted/30 p-6 space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
									<GiftIcon className="size-4 text-primary" />
									Your referral link
								</div>
								<div className="flex items-center gap-2">
									<div className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground/70 truncate font-mono">
										{result.referralLink}
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => void copyReferralLink()}
										className="shrink-0"
										disabled={!canCopyReferralLink}
									>
										{copied ? "Copied!" : "Copy"}
									</Button>
								</div>
								<p className="text-xs text-foreground/50">
									Each person who joins using your link moves
									you up the priority queue. Refer 3+ people
									to get early access.
								</p>
							</div>

							{/* Share buttons */}
							<div className="flex flex-wrap gap-3 justify-center">
								<Button variant="outline" size="sm" asChild>
									<a
										href={`https://twitter.com/intent/tweet?text=I%20just%20joined%20the%20SmartBeak%20waitlist%20%E2%80%94%20the%20AI-powered%20content%20publishing%20platform%20for%20domain%20portfolio%20owners.%20Join%20me%3A%20${encodeURIComponent(result.referralLink)}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Share on X
									</a>
								</Button>
								<Button variant="outline" size="sm" asChild>
									<a
										href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(result.referralLink)}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Share on LinkedIn
									</a>
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
