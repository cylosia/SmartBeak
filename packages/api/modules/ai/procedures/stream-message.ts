import { streamToEventIterator } from "@orpc/client";
import {
	convertToModelMessages,
	streamText,
	textModel,
	type UIMessage,
} from "@repo/ai";
import z from "zod";
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
			messages: z.array(
				z.object({
					id: z.string(),
					role: z.enum(["user", "assistant", "system"]),
					content: z.string().max(32_000),
					parts: z.array(z.record(z.unknown())).optional(),
				}).passthrough() as unknown as z.ZodType<UIMessage>,
			).max(100),
		}),
	)
	.handler(async ({ input }) => {
		const { messages } = input;

		const response = streamText({
			model: textModel,
			messages: await convertToModelMessages(messages),
		});

		return streamToEventIterator(response.toUIMessageStream());
	});
