import { addKeyword, removeKeyword } from "./procedures/manage-keywords";
import { getSeo } from "./procedures/get-seo";

export const seoRouter = {
  get: getSeo,
  addKeyword,
  removeKeyword,
};
