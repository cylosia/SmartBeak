"use server";

import { logger } from "@repo/logs";
import { revalidatePath } from "next/cache";

const SAFE_PATH = /^\/[a-zA-Z0-9\-_/.]*$/;
const MAX_PATH_LENGTH = 500;

export const clearCache = async (path?: string) => {
	try {
		if (path) {
			if (
				path.length > MAX_PATH_LENGTH ||
				!SAFE_PATH.test(path) ||
				path.includes("..")
			) {
				return;
			}
			revalidatePath(path);
		} else {
			revalidatePath("/", "layout");
		}
	} catch (error) {
		logger.warn("Could not revalidate path", { path, error });
	}
};
