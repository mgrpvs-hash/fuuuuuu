import Database from "better-sqlite3";
import path from "node:path";

import { env } from "../config/env.js";
import { AppDatabase } from "../db/database.js";

async function main(): Promise<void> {
  const dbService = await AppDatabase.init(env.DATABASE_URL);
  const dbPath = path.isAbsolute(env.DATABASE_URL)
    ? env.DATABASE_URL
    : path.resolve(process.cwd(), env.DATABASE_URL);
  const rawDb = new Database(dbPath);
  rawDb.pragma("foreign_keys = ON");

  const telegramUserId = 990000002;
  const fileId = `test-content-flow-${Date.now()}`;
  const description = "Описание для теста SQLite flow";
  let mediaItemId = 0;
  let contentId = 0;

  try {
    mediaItemId = dbService.createMediaItem({
      telegramUserId,
      telegramFileId: fileId,
      mediaType: "image",
      localPath: "/workspace/media/test-flow.jpg",
      storageUrlOriginal: "https://example.com/original-flow.jpg"
    });

    contentId = dbService.createGeneratedContent({
      telegramUserId,
      mediaItemId,
      contentType: "post",
      language: "ru",
      description,
      captions: ["Тестовый пост для проверки runtime flow."],
      hashtags: ["#mcclinic", "#testflow"],
      cta: "Запишитесь на консультацию.",
      storyText: "Story",
      visualTitle: "Современное пространство для ухода",
      visualSubtitle: "Комфорт и внимание",
      designHint: "clean_light"
    });

    dbService.updateDesignMetadata({
      contentId,
      designVariant: "clean_light",
      designSeed: `seed-${Date.now()}`,
      incrementAttempt: true
    });
    dbService.updateMediaDesignResult({
      mediaItemId,
      storageUrlProcessed: "https://example.com/processed-flow.jpg",
      processedMediaPath: "/workspace/tmp/processed-flow.jpg",
      mediaProcessingStatus: "processed",
      mediaDesignVersion: "photo-v4/clean_light"
    });
    dbService.setFinalInstagramCaption(
      contentId,
      "Тестовый пост для проверки runtime flow.\n\nЗапишитесь на консультацию.\n\n#mcclinic #testflow"
    );

    const storedContent = dbService.getGeneratedContentById(contentId);
    const storedMedia = dbService.getMediaItemById(mediaItemId);
    if (!storedContent || !storedMedia) {
      throw new Error("Failed to load saved workflow records");
    }
    if (!storedContent.final_instagram_caption || !storedContent.visual_title) {
      throw new Error("Saved generated content is missing required fields");
    }
    if (!storedMedia.storage_url_processed || storedMedia.media_processing_status !== "processed") {
      throw new Error("Saved media item is missing processed metadata");
    }

    console.log("test:content-workflow-db passed", {
      mediaItemId,
      contentId,
      designVariant: storedContent.design_variant,
      designAttemptNumber: storedContent.design_attempt_number
    });
  } finally {
    if (contentId) {
      rawDb.prepare("DELETE FROM generated_contents WHERE id = ?").run(contentId);
    }
    if (mediaItemId) {
      rawDb.prepare("DELETE FROM media_items WHERE id = ?").run(mediaItemId);
    }
    rawDb.prepare("DELETE FROM users WHERE telegram_user_id = ?").run(telegramUserId);
    rawDb.close();
  }
}

main().catch((error) => {
  console.error(
    `test:content-workflow-db failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});

