import { createMediaUploadUrl } from "./procedures/create-media-upload-url";
import { deleteMediaProcedure } from "./procedures/delete-media";
import { listMedia } from "./procedures/list-media";

export const mediaRouter = {
  list: listMedia,
  createUploadUrl: createMediaUploadUrl,
  delete: deleteMediaProcedure,
};
