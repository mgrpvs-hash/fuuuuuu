import fs from "node:fs";
import path from "node:path";

import { createTelegramBot } from "./bot/bot.js";
import { env } from "./config/env.js";
import { AppDatabase } from "./db/database.js";
import { AssistantCommandService } from "./services/assistant-command.service.js";
import { ContentWorkflowService } from "./services/content-workflow.service.js";
import { DesignSelectionService } from "./services/design-selection.service.js";
import { InstagramService } from "./services/instagram.service.js";
import { MediaDesignService } from "./services/media-design.service.js";
import { MediaValidationService } from "./services/media-validation.service.js";
import { OpenAiService } from "./services/openai.service.js";
import { RateLimitService } from "./services/rate-limit.service.js";
import { SafetyService } from "./services/safety.service.js";
import { SchedulerService } from "./services/scheduler.service.js";
import { StorageService } from "./services/storage.service.js";
import { TextPosterDesignService } from "./services/text-poster-design.service.js";
import { VideoDesignService } from "./services/video-design.service.js";
import { logger } from "./utils/logger.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function resolveBuildVersion(): string {
  try {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
      version?: string;
    };
    if (pkg.version) {
      return pkg.version;
    }
  } catch {
    // ignore and fallback
  }
  return new Date().toISOString();
}

async function bootstrap(): Promise<void> {
  const buildVersion = resolveBuildVersion();
  const db = await AppDatabase.init(env.DATABASE_URL);
  const safetyService = new SafetyService();
  const mediaValidationService = new MediaValidationService();
  const storageService = new StorageService();
  const mediaDesignService = new MediaDesignService();
  const textPosterDesignService = new TextPosterDesignService();
  const videoDesignService = new VideoDesignService();
  const designSelectionService = new DesignSelectionService();
  const assistantCommandService = new AssistantCommandService();
  const aiService = new OpenAiService();
  const instagramService = new InstagramService();
  const workflowService = new ContentWorkflowService(
    db,
    safetyService,
    instagramService,
    mediaValidationService
  );
  const rateLimitService = new RateLimitService(
    env.RATE_LIMIT_WINDOW_MS,
    env.RATE_LIMIT_MAX_REQUESTS
  );

  const bot = createTelegramBot({
    db,
    aiService,
    safetyService,
    workflowService,
    mediaValidationService,
    storageService,
    mediaDesignService,
    textPosterDesignService,
    videoDesignService,
    designSelectionService,
    assistantCommandService,
    rateLimitService
  });

  const scheduler = new SchedulerService(db, workflowService);
  scheduler.start();
  logger.info("Telegram bootstrap preflight", {
    mode: env.TELEGRAM_MODE,
    buildVersion,
    instagramPublishFlow: "unified-v2"
  });

  let botUsername = "@unknown";
  let botId: number | "unknown" = "unknown";
  try {
    const me = await withTimeout(bot.telegram.getMe(), 10000);
    botUsername = `@${me.username ?? "unknown"}`;
    botId = me.id;
  } catch (error) {
    logger.warn("Failed to fetch bot identity before launch", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const launchPromise =
    env.TELEGRAM_MODE === "webhook"
      ? bot.launch({
          webhook: {
            domain: env.TELEGRAM_WEBHOOK_DOMAIN!,
            hookPath: env.TELEGRAM_WEBHOOK_PATH,
            port: env.PORT,
            secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN
          }
        })
      : bot.launch();

  launchPromise.catch((error) => {
    logger.error("Telegram launch failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  if (env.TELEGRAM_MODE === "webhook") {
    logger.info("Telegram bot started in webhook mode", {
      botUsername,
      botId,
      buildVersion,
      instagramPublishFlow: "unified-v2"
    });
  } else {
    logger.info("Telegram bot started in polling mode", {
      botUsername,
      botId,
      buildVersion,
      instagramPublishFlow: "unified-v2"
    });
  }

  process.once("SIGINT", async () => {
    scheduler.stop();
    await bot.stop();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    scheduler.stop();
    await bot.stop();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.error("Fatal startup error", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
