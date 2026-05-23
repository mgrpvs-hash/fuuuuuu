import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  DATABASE_URL: z.string().default("./data/app.db"),
  INSTAGRAM_ACCESS_TOKEN: z.string().min(1, "INSTAGRAM_ACCESS_TOKEN is required"),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z
    .string()
    .min(1, "INSTAGRAM_BUSINESS_ACCOUNT_ID is required"),
  INSTAGRAM_GRAPH_API_BASE: z.string().default("https://graph.facebook.com/v20.0"),
  MEDIA_PUBLIC_BASE_URL: z.string().optional(),
  DEFAULT_TONE: z.string().default("professional"),
  DEFAULT_LANGUAGE: z.enum(["ru", "en"]).default("ru"),
  TIMEZONE: z.string().default("UTC")
});

export type AppEnv = z.infer<typeof envSchema>;
export const env: AppEnv = envSchema.parse(process.env);
