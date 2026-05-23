import { createTelegramBot } from "./bot/bot.js";
import { env } from "./config/env.js";
import { AppDatabase } from "./db/database.js";
import { ContentWorkflowService } from "./services/content-workflow.service.js";
import { InstagramService } from "./services/instagram.service.js";
import { OpenAiService } from "./services/openai.service.js";
import { SafetyService } from "./services/safety.service.js";
import { SchedulerService } from "./services/scheduler.service.js";
import { logger } from "./utils/logger.js";

async function bootstrap(): Promise<void> {
  const db = await AppDatabase.init(env.DATABASE_URL);
  const safetyService = new SafetyService();
  const aiService = new OpenAiService();
  const instagramService = new InstagramService();
  const workflowService = new ContentWorkflowService(db, safetyService, instagramService);

  const bot = createTelegramBot({
    db,
    aiService,
    safetyService,
    workflowService
  });

  const scheduler = new SchedulerService(db, workflowService);
  scheduler.start();

  await bot.launch();
  logger.info("Telegram bot launched");

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
