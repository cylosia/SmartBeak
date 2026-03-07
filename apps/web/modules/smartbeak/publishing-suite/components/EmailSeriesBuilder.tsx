"use client";
import { Button } from "@repo/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	GripVerticalIcon,
	MailIcon,
	PlusIcon,
	SendIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";

interface SeriesStep {
	subject: string;
	htmlBody: string;
	delayDays: number;
	contentId?: string;
}

const DEFAULT_STEP: SeriesStep = { subject: "", htmlBody: "", delayDays: 0 };

export function EmailSeriesBuilder({
	organizationSlug,
	domainId,
	open,
	onClose,
}: {
	organizationSlug: string;
	domainId: string;
	open: boolean;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [seriesName, setSeriesName] = useState("");
	const [fromName, setFromName] = useState("");
	const [fromEmail, setFromEmail] = useState("");
	const [replyTo, setReplyTo] = useState("");
	const [startAt, setStartAt] = useState("");
	const [steps, setSteps] = useState<SeriesStep[]>([{ ...DEFAULT_STEP }]);
	const [expandedStep, setExpandedStep] = useState<number>(0);

	const createMutation = useMutation(
		orpc.smartbeak.publishingSuite.emailSeries.mutationOptions({
			onSuccess: (data) => {
				toastSuccess(
					"Email series created",
					`${data.stepCount} emails scheduled for "${data.seriesName}".`,
				);
				queryClient.invalidateQueries({
					queryKey: ["smartbeak", "publishingSuite"],
				});
				onClose();
			},
			onError: (err: unknown) =>
				toastError(
					"Failed to create series",
					err instanceof Error ? err.message : "Unknown error",
				),
		}),
	);

	const addStep = () =>
		setSteps((s) => [
			...s,
			{
				...DEFAULT_STEP,
				delayDays: (s[s.length - 1]?.delayDays ?? 0) + 7,
			},
		]);
	const removeStep = (i: number) =>
		setSteps((s) => s.filter((_, idx) => idx !== i));
	const updateStep = (i: number, patch: Partial<SeriesStep>) =>
		setSteps((s) =>
			s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)),
		);
	const moveStep = (i: number, dir: -1 | 1) => {
		setSteps((s) => {
			const next = [...s];
			const target = i + dir;
			if (target < 0 || target >= next.length) {
				return s;
			}
			const a = next[i];
			const b = next[target];
			if (a !== undefined && b !== undefined) {
				next[i] = b;
				next[target] = a;
			}
			return next;
		});
	};

	const handleSubmit = () => {
		if (!seriesName || !fromName || !fromEmail || steps.length === 0) {
			toastError(
				"Missing fields",
				"Fill in series name, sender, and at least one step.",
			);
			return;
		}
		createMutation.mutate({
			organizationSlug,
			domainId,
			seriesName,
			fromName,
			fromEmail,
			replyTo: replyTo || undefined,
			startAt: startAt || undefined,
			steps,
		});
	};

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MailIcon className="h-5 w-5 text-purple-500" />
						Email Series Builder
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					{/* Series metadata */}
					<div className="grid grid-cols-2 gap-3">
						<div className="col-span-2">
							<label
								htmlFor="series-name"
								className="mb-1 block text-xs font-medium text-muted-foreground"
							>
								Series Name
							</label>
							<Input
								id="series-name"
								placeholder="e.g. Welcome Sequence"
								value={seriesName}
								onChange={(e) => setSeriesName(e.target.value)}
							/>
						</div>
						<div>
							<label
								htmlFor="from-name"
								className="mb-1 block text-xs font-medium text-muted-foreground"
							>
								From Name
							</label>
							<Input
								id="from-name"
								placeholder="Your Name"
								value={fromName}
								onChange={(e) => setFromName(e.target.value)}
							/>
						</div>
						<div>
							<label
								htmlFor="from-email"
								className="mb-1 block text-xs font-medium text-muted-foreground"
							>
								From Email
							</label>
							<Input
								id="from-email"
								placeholder="you@domain.com"
								value={fromEmail}
								onChange={(e) => setFromEmail(e.target.value)}
							/>
						</div>
						<div>
							<label
								htmlFor="reply-to"
								className="mb-1 block text-xs font-medium text-muted-foreground"
							>
								Reply-To (optional)
							</label>
							<Input
								id="reply-to"
								placeholder="reply@domain.com"
								value={replyTo}
								onChange={(e) => setReplyTo(e.target.value)}
							/>
						</div>
						<div>
							<label
								htmlFor="start-at"
								className="mb-1 block text-xs font-medium text-muted-foreground"
							>
								Start Date (optional)
							</label>
							<Input
								id="start-at"
								type="datetime-local"
								value={startAt}
								onChange={(e) => setStartAt(e.target.value)}
							/>
						</div>
					</div>

					{/* Steps */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<h4 className="text-sm font-semibold">
								Steps ({steps.length})
							</h4>
							<Button
								size="sm"
								variant="outline"
								onClick={addStep}
								className="h-7 text-xs"
							>
								<PlusIcon className="mr-1 h-3 w-3" /> Add Step
							</Button>
						</div>

						{steps.map((step, i) => (
							<div
								key={`step-${step.subject}-${step.delayDays}-${i}`}
								className="rounded-lg border border-border bg-background"
							>
								{/* Step header */}
								<button
									type="button"
									className="flex w-full cursor-pointer items-center gap-2 px-3 py-2"
									onClick={() =>
										setExpandedStep(
											expandedStep === i ? -1 : i,
										)
									}
								>
									<GripVerticalIcon className="h-4 w-4 text-muted-foreground" />
									<span className="flex-1 text-sm font-medium">
										Step {i + 1}
										{step.subject
											? ` — ${step.subject}`
											: ""}
									</span>
									<span className="text-xs text-muted-foreground">
										Day {step.delayDays}
									</span>
									<div className="flex gap-1">
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0"
											onClick={(e) => {
												e.stopPropagation();
												moveStep(i, -1);
											}}
											disabled={i === 0}
											aria-label="Move step up"
										>
											<ChevronUpIcon className="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0"
											onClick={(e) => {
												e.stopPropagation();
												moveStep(i, 1);
											}}
											disabled={i === steps.length - 1}
											aria-label="Move step down"
										>
											<ChevronDownIcon className="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-destructive hover:text-destructive/80"
											onClick={(e) => {
												e.stopPropagation();
												removeStep(i);
											}}
											disabled={steps.length === 1}
											aria-label="Remove step"
										>
											<Trash2Icon className="h-3 w-3" />
										</Button>
									</div>
								</button>

								{/* Step body */}
								{expandedStep === i && (
									<div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
										<div className="grid grid-cols-2 gap-3">
											<div>
												<label
													htmlFor={`step-subject-${i}`}
													className="mb-1 block text-xs font-medium text-muted-foreground"
												>
													Subject
												</label>
												<Input
													id={`step-subject-${i}`}
													placeholder="Email subject line"
													value={step.subject}
													onChange={(e) =>
														updateStep(i, {
															subject:
																e.target.value,
														})
													}
												/>
											</div>
											<div>
												<label
													htmlFor={`step-delay-${i}`}
													className="mb-1 block text-xs font-medium text-muted-foreground"
												>
													Send after (days)
												</label>
												<Input
													id={`step-delay-${i}`}
													type="number"
													min={0}
													max={365}
													value={step.delayDays}
													onChange={(e) =>
														updateStep(i, {
															delayDays: Math.max(
																0,
																Number(
																	e.target
																		.value,
																) || 0,
															),
														})
													}
												/>
											</div>
										</div>
										<div>
											<label
												htmlFor={`step-body-${i}`}
												className="mb-1 block text-xs font-medium text-muted-foreground"
											>
												HTML Body
											</label>
											<Textarea
												id={`step-body-${i}`}
												rows={5}
												placeholder="<p>Your email content here...</p>"
												value={step.htmlBody}
												onChange={(e) =>
													updateStep(i, {
														htmlBody:
															e.target.value,
													})
												}
												className="font-mono text-xs"
											/>
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={createMutation.isPending}
						className="gap-2"
					>
						<SendIcon className="h-4 w-4" />
						{createMutation.isPending
							? "Creating…"
							: "Create Series"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
