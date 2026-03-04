import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { THEME_CONFIGS } from "../lib/themes";

export const listThemes = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/deploy/themes",
    tags: ["SmartBeak - Deploy"],
    summary: "List available deployment themes",
  })
  .input(z.object({}))
  .handler(async () => {
    const themes = Object.entries(THEME_CONFIGS).map(([id, config]) => ({
      id,
      ...config,
    }));
    return { themes };
  });
