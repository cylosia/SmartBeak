import { createContentItemProcedure } from "./procedures/create-content-item";
import { deleteContentItemProcedure } from "./procedures/delete-content-item";
import { getContentItem } from "./procedures/get-content-item";
import { listContent } from "./procedures/list-content";
import { updateContentItemProcedure } from "./procedures/update-content-item";

export const contentRouter = {
	list: listContent,
	get: getContentItem,
	create: createContentItemProcedure,
	update: updateContentItemProcedure,
	delete: deleteContentItemProcedure,
};
