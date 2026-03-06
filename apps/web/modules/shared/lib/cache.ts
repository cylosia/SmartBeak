"use server";

import { revalidatePath } from "next/cache";
import { logger } from "@repo/logs";

export const clearCache = async (path?: string) => {
	try {
		if (path) {
			revalidatePath(path);
		} else {
			revalidatePath("/", "layout");
		}
	} catch (error) {
		logger.warn("Could not revalidate path", { path, error });
	}
};
