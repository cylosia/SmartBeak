import { getSeo } from "./procedures/get-seo";
import { addKeyword, removeKeyword } from "./procedures/manage-keywords";

export const seoRouter = {
	get: getSeo,
	addKeyword,
	removeKeyword,
};
