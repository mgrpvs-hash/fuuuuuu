import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  TELEGRAM_BOT_TOKEN: z.string().min(20, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_BOT_MODE: z.enum(["webhook", "polling"]).default("webhook"),
  TELEGRAM_WEBHOOK_DOMAIN: z.string().url().optional(),
  TELEGRAM_WEBHOOK_PATH: z.string().min(1).default("/telegram/webhook"),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(12).optional(),

  OPENAI_API_KEY: z.string().min(10, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

  DATABASE_URL: z.string().default("./data/app.db"),

  INSTAGRAM_ACCESS_TOKEN: z.string().min(10, "INSTAGRAM_ACCESS_TOKEN is required"),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z
    .string()
    .min(1, "INSTAGRAM_BUSINESS_ACCOUNT_ID is required"),
  INSTAGRAM_GRAPH_API_BASE: z.string().url().default("https://graph.facebook.com/v20.0"),
  INSTAGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  INSTAGRAM_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  INSTAGRAM_RETRY_MIN_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(700),
  INSTAGRAM_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(200).max(60000).default(8000),
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),

  DEFAULT_TONE: z.string().default("professional"),
  DEFAULT_LANGUAGE: z.enum(["ru", "en"]).default("ru"),
  TIMEZONE: z.string().default("UTC"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(1000).default(30),
  MAX_MEDIA_FILE_SIZE_MB: z.coerce.number().int().min(1).max(200).default(50),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
});

const envSchema = baseSchema.superRefine((value, ctx) => {
  if (value.TELEGRAM_BOT_MODE === "webhook") {
    if (!value.TELEGRAM_WEBHOOK_DOMAIN) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_WEBHOOK_DOMAIN"],
        message: "TELEGRAM_WEBHOOK_DOMAIN is required in webhook mode"
      });
    }
    if (!value.MEDIA_PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["MEDIA_PUBLIC_BASE_URL"],
        message: "MEDIA_PUBLIC_BASE_URL is required in production-like publishing flows"
      });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;
export const env: AppEnv = envSchema.parse(process.env);
