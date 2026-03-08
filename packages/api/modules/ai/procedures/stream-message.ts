import { streamToEventIterator } from "@orpc/client";
import { ORPCError } from "@orpc/server";
import {
	convertToModelMessages,
	streamText,
	textModel,
	type UIMessage,
} from "@repo/ai";
import {
	checkAiBudget,
	recordAiSpend,
} from "@repo/api/infrastructure/ai-budget";
import z from "zod";
import { protectedRateLimitMiddleware } from "../../../orpc/middleware/rate-limit-middleware";
import { protectedProcedure } from "../../../orpc/procedures";

const MAX_TOTAL_MESSAGE_CHARS = 100_000;
const ESTIMATED_CHAT_COST_CENTS = 2;

export const streamMessage = protectedProcedure
	.route({
		method: "POST",
		path: "/ai/stream",
		tags: ["AI"],
		summary: "Stream AI response",
		description: "Stream an AI response without storing the chat",
	})
	.input(
		z.object({
			messages: z
				.array(
					z.object({
						id: z.string(),
						role: z.enum(["user", "assistant"]),
						content: z.string().max(32_000),
						parts: z
							.array(
								z
									.record(z.unknown())
									.refine(
										(v) =>
											JSON.stringify(v).length <= 10_000,
										"Part payload too large",
									),
							)
							.max(20)
							.optional(),
					}) as unknown as z.ZodType<UIMessage>,
				)
				.max(100),
		}),
	)
	.use(protectedRateLimitMiddleware({ limit: 20, windowMs: 60_000 }))
	.handler(async ({ input, context: { session } }) => {
		const { messages } = input;
		const totalMessageChars = messages.reduce((sum, message) => {
			const partsSize = (message.parts ?? []).reduce(
				(partsSum, part) => partsSum + JSON.stringify(part).length,
				0,
			);
			return sum + message.content.length + partsSize;
		}, 0);

		if (totalMessageChars > MAX_TOTAL_MESSAGE_CHARS) {
			throw new ORPCError("PAYLOAD_TOO_LARGE", {
				message: "Combined message payload is too large.",
			});
		}

		const orgId = (session as { activeOrganizationId?: string })
			.activeOrganizationId;
		if (orgId) {
			await checkAiBudget(orgId, ESTIMATED_CHAT_COST_CENTS);
		}

		const response = streamText({
			model: textModel,
			messages: await convertToModelMessages(messages),
		});

		if (orgId) {
			recordAiSpend(orgId, ESTIMATED_CHAT_COST_CENTS).catch(() => {});
		}

		return streamToEventIterator(response.toUIMessageStream());
	});
