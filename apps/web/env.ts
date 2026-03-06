import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
});

const optionalSchema = z.object({
  SMARTBEAK_ENCRYPTION_KEY: z.string().optional(),
  ENTERPRISE_ENCRYPTION_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MAIL_PROVIDER: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  LEMONSQUEEZY_API_KEY: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
});

let validated = false;

export function validateEnv() {
  if (validated) return;
  if (typeof window !== "undefined") return;

  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Missing required environment variables:\n${formatted}\n\nCheck your .env.local file.`,
    );
  }

  optionalSchema.safeParse(process.env);
  validated = true;
}
