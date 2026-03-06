import { streamToEventIterator } from "@orpc/client";
import {
	convertToModelMessages,
	streamText,
	textModel,
	type UIMessage,
} from "@repo/ai";
import z from "zod";
import { protectedRateLimitMiddleware } from "../../../orpc/middleware/rate-limit-middleware";
import { protectedProcedure } from "../../../orpc/procedures";

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
	.handler(async ({ input }) => {
		const { messages } = input;

		const response = streamText({
			model: textModel,
			messages: await convertToModelMessages(messages),
		});

		return streamToEventIterator(response.toUIMessageStream());
	});
