import { completeMediaUploadProcedure } from "./procedures/complete-media-upload";
import { createMediaUploadUrl } from "./procedures/create-media-upload-url";
import { deleteMediaProcedure } from "./procedures/delete-media";
import { listMedia } from "./procedures/list-media";

export const mediaRouter = {
	list: listMedia,
	createUploadUrl: createMediaUploadUrl,
	completeUpload: completeMediaUploadProcedure,
	delete: deleteMediaProcedure,
};
