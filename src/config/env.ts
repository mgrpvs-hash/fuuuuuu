import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const rawEnv = {
  ...process.env,
  TELEGRAM_MODE: process.env.TELEGRAM_MODE ?? process.env.TELEGRAM_BOT_MODE ?? "polling"
};

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    TELEGRAM_BOT_TOKEN: z.string().min(20, "TELEGRAM_BOT_TOKEN is required"),
    TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
    TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
    TELEGRAM_WEBHOOK_DOMAIN: z.string().url().optional(),
    TELEGRAM_WEBHOOK_PATH: z.string().min(1).default("/telegram/webhook"),
    TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(12).optional(),

    OPENAI_API_KEY: z.string().min(10, "OPENAI_API_KEY is required"),
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    OPENAI_IMAGE_GENERATION_ENABLED: z.preprocess(
      (value) => {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") return value.trim().toLowerCase() === "true";
        return false;
      },
      z.boolean()
    ),
    OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),

    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    FACEBOOK_PAGE_ID: z.string().optional(),
    INSTAGRAM_USERNAME: z.string().optional(),
    INSTAGRAM_ACCESS_TOKEN: z.string().min(10, "INSTAGRAM_ACCESS_TOKEN is required"),
    INSTAGRAM_BUSINESS_ACCOUNT_ID: z
      .string()
      .min(1, "INSTAGRAM_BUSINESS_ACCOUNT_ID is required"),
    INSTAGRAM_GRAPH_API_BASE: z.string().url().default("https://graph.facebook.com/v20.0"),
    INSTAGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    INSTAGRAM_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
    INSTAGRAM_RETRY_MIN_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(700),
    INSTAGRAM_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(200).max(60000).default(8000),

    MEDIA_STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().optional(),
    SUPABASE_PUBLIC_FOLDER: z.string().default("uploads"),

    DATABASE_URL: z.string().default("./data/app.db"),
    DEFAULT_TONE: z.string().default("professional"),
    DEFAULT_LANGUAGE: z.enum(["ru", "en"]).default("ru"),
    TIMEZONE: z.string().default("UTC"),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(1000).default(30),
    MAX_MEDIA_FILE_SIZE_MB: z.coerce.number().int().min(1).max(200).default(50),
    MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().min(5).max(3600).default(300)
  })
  .superRefine((value, ctx) => {
    if (value.TELEGRAM_MODE === "webhook" && !value.TELEGRAM_WEBHOOK_DOMAIN) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_WEBHOOK_DOMAIN"],
        message: "TELEGRAM_WEBHOOK_DOMAIN is required when TELEGRAM_MODE=webhook"
      });
    }

    if (value.MEDIA_STORAGE_PROVIDER === "supabase") {
      if (!value.SUPABASE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_URL"],
          message: "SUPABASE_URL is required when MEDIA_STORAGE_PROVIDER=supabase"
        });
      }
      if (!value.SUPABASE_SECRET_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_SECRET_KEY"],
          message: "SUPABASE_SECRET_KEY is required when MEDIA_STORAGE_PROVIDER=supabase"
        });
      }
      if (!value.SUPABASE_STORAGE_BUCKET) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_STORAGE_BUCKET"],
          message: "SUPABASE_STORAGE_BUCKET is required when MEDIA_STORAGE_PROVIDER=supabase"
        });
      }
    }
  });

const parsed = schema.parse(rawEnv);

const allowedTelegramUserIds = parsed.TELEGRAM_ALLOWED_USER_IDS.split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item))
  .filter((value) => Number.isInteger(value));

export type AppEnv = z.infer<typeof schema> & {
  TELEGRAM_ALLOWED_USER_IDS_LIST: number[];
};

export const env: AppEnv = {
  ...parsed,
  TELEGRAM_ALLOWED_USER_IDS_LIST: allowedTelegramUserIds
};
