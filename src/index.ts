import { createTelegramBot } from "./bot/bot.js";
import { env } from "./config/env.js";
import { AppDatabase } from "./db/database.js";
import { ContentWorkflowService } from "./services/content-workflow.service.js";
import { InstagramService } from "./services/instagram.service.js";
import { MediaValidationService } from "./services/media-validation.service.js";
import { OpenAiService } from "./services/openai.service.js";
import { RateLimitService } from "./services/rate-limit.service.js";
import { SafetyService } from "./services/safety.service.js";
import { SchedulerService } from "./services/scheduler.service.js";
import { logger } from "./utils/logger.js";

async function bootstrap(): Promise<void> {
  const db = await AppDatabase.init(env.DATABASE_URL);
  const safetyService = new SafetyService();
  const mediaValidationService = new MediaValidationService();
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
    rateLimitService
  });

  const scheduler = new SchedulerService(db, workflowService);
  scheduler.start();

  if (env.TELEGRAM_BOT_MODE === "webhook") {
    await bot.launch({
      webhook: {
        domain: env.TELEGRAM_WEBHOOK_DOMAIN!,
        hookPath: env.TELEGRAM_WEBHOOK_PATH,
        port: env.PORT,
        secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN
      }
    });
    logger.info("Telegram bot launched in webhook mode", {
      domain: env.TELEGRAM_WEBHOOK_DOMAIN,
      hookPath: env.TELEGRAM_WEBHOOK_PATH,
      port: env.PORT
    });
  } else {
    await bot.launch();
    logger.info("Telegram bot launched in polling mode");
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
