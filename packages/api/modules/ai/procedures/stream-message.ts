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
				z
					.object({
					role: z.string().min(1),
					content: z.string().min(1),
					})
					.passthrough(),
			),
		}),
	)
	.handler(async ({ input }) => {
		const { messages } = input;

		const response = streamText({
			model: textModel,
			messages: await convertToModelMessages(
				messages as unknown as UIMessage[],
			),
		});

		return streamToEventIterator(response.toUIMessageStream());
	});
