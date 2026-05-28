import Database from "better-sqlite3";
import path from "node:path";

import { env } from "../config/env.js";
import { AppDatabase } from "../db/database.js";
import { AssistantCommandService } from "../services/assistant-command.service.js";
import { formatInstagramCaption } from "../services/caption-formatter.service.js";
import { TextPosterDesignService } from "../services/text-poster-design.service.js";

async function main(): Promise<void> {
  const db = await AppDatabase.init(env.DATABASE_URL);
  const classifier = new AssistantCommandService();
  const posterService = new TextPosterDesignService();

  const input = "сделай картинку доброе утро пейте витамины";
  const intent = classifier.classify(input);
  if (intent.type !== "create_text_poster") {
    throw new Error(`Expected create_text_poster intent, got ${intent.type}`);
  }

  const telegramUserId = 990000003;
  const poster = await posterService.createPoster({
    userPrompt: input,
    language: "ru",
    brandName: "MC Clinic Medical",
    brandHandle: "@mc_clinic.du",
    posterType: "morning_health",
    visualTitle: "Доброе утро! Начните день с заботы о себе",
    visualSubtitle: "Приём добавок и витаминов лучше обсуждать со специалистом."
  });

  const mediaItemId = db.createMediaItem({
    telegramUserId,
    telegramFileId: `generated-poster:${Date.now()}`,
    mediaType: "image",
    localPath: poster.outputPath
  });
  db.updateMediaDesignResult({
    mediaItemId,
    storageUrlProcessed: "https://example.com/poster-flow.jpg",
    processedMediaPath: poster.outputPath,
    mediaProcessingStatus: "processed",
    mediaDesignVersion: poster.designVersion
  });

  const posterCaption = "Доброе утро! Начните день с заботы о себе.";
  const contentId = db.createGeneratedContent({
    telegramUserId,
    mediaItemId,
    contentType: "post",
    language: "ru",
    description: input,
    captions: [posterCaption],
    hashtags: ["#mcclinic", "#health", "#wellness", "#cliniclife", "#medicalcare", "#care", "#diagnostics", "#prevention"],
    cta: "Запишитесь на профилактический осмотр.",
    storyText: "",
    visualTitle: "Доброе утро! Начните день с заботы о себе",
    visualSubtitle: "Приём добавок и витаминов лучше обсуждать со специалистом.",
    designHint: "morning_health"
  });

  const formatted = formatInstagramCaption({
    selectedCaption: posterCaption,
    cta: "Запишитесь на профилактический осмотр.",
    hashtags: ["#mcclinic", "#health", "#wellness", "#cliniclife", "#medicalcare", "#care", "#diagnostics", "#prevention"],
    contentType: "post"
  });
  db.updateFinalCaptionAndHashtags({
    contentId,
    finalCaption: formatted.caption,
    hashtags: formatted.hashtags,
    selectedCaption: posterCaption
  });
  db.setUseOriginalMedia(contentId, false);
  db.updateDesignMetadata({
    contentId,
    designVariant: "morning_health",
    designSeed: `poster-seed-${Date.now()}`,
    incrementAttempt: true
  });

  const savedContent = db.getGeneratedContentById(contentId);
  const savedMedia = db.getMediaItemById(mediaItemId);
  if (!savedContent || !savedMedia) {
    throw new Error("Failed to read saved poster flow rows");
  }
  if (!savedMedia.storage_url_processed) {
    throw new Error("processed_media_url was not saved");
  }
  if (!savedContent.final_instagram_caption) {
    throw new Error("final_instagram_caption was not saved");
  }
  if (savedContent.status !== "draft") {
    throw new Error("Poster flow should stay in draft status until Approve");
  }

  const dbPath = path.isAbsolute(env.DATABASE_URL)
    ? env.DATABASE_URL
    : path.resolve(process.cwd(), env.DATABASE_URL);
  const rawDb = new Database(dbPath);
  rawDb.prepare("DELETE FROM generated_contents WHERE id = ?").run(contentId);
  rawDb.prepare("DELETE FROM media_items WHERE id = ?").run(mediaItemId);
  rawDb.prepare("DELETE FROM users WHERE telegram_user_id = ?").run(telegramUserId);
  rawDb.close();

  console.log("test:text-poster-flow passed", {
    intent: intent.type,
    mediaItemId,
    contentId,
    variant: savedContent.design_variant
  });
}

main().catch((error) => {
  console.error(`test:text-poster-flow failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

