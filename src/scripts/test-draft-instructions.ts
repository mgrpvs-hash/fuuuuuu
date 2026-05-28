import fs from "node:fs";
import path from "node:path";

import { AppDatabase } from "../db/database.js";
import { AssistantCommandService } from "../services/assistant-command.service.js";
import { DraftEditService } from "../services/draft-edit.service.js";
import { OpenAiService } from "../services/openai.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const dbPath = path.resolve(process.cwd(), "tmp", "test-draft-instructions.sqlite");
  fs.rmSync(dbPath, { force: true });

  const db = await AppDatabase.init(dbPath);
  const telegramUserId = 88442211;
  const mediaItemId = db.createMediaItem({
    telegramUserId,
    telegramFileId: "mock-file-id",
    mediaType: "image",
    localPath: "/tmp/mock-draft-image.jpg"
  });

  const contentId = db.createGeneratedContent({
    telegramUserId,
    mediaItemId,
    contentType: "post",
    language: "ru",
    description: "Фото ресепшн клиники",
    captions: ["Добро пожаловать в нашу клинику."],
    hashtags: ["#клиника", "#здоровье"],
    cta: "Запишитесь на консультацию.",
    storyText: "История",
    visualTitle: "Комфортный визит в клинику",
    visualSubtitle: "Спокойная и современная атмосфера",
    overlayBullets: ["Удобная зона ожидания"],
    overlayDensity: "medium",
    designHint: "clean_light"
  });

  db.updateFinalCaptionAndHashtags({
    contentId,
    finalCaption: "Мы создаём комфортное пространство для консультаций.\n\n#клиника #здоровье",
    hashtags: ["#клиника", "#здоровье"],
    selectedCaption: "Мы создаём комфортное пространство для консультаций."
  });

  const draftEditService = new DraftEditService(
    db,
    new AssistantCommandService(),
    new OpenAiService()
  );

  const result = await draftEditService.applyDraftInstruction({
    draftId: contentId,
    userId: telegramUserId,
    instruction: "смотри добавь больше текста и разъяснений в фотку текста"
  });

  const updated = db.getGeneratedContentById(contentId);
  assert(updated, "Updated draft not found");
  assert(result.classification.intent === "increase_overlay_text", "intent should be increase_overlay_text");
  assert(updated!.overlay_density === "detailed", "overlay density should be detailed");

  const bullets = parseArray(updated!.overlay_bullets_json);
  assert(bullets.length >= 2, "overlay bullets should contain at least 2 points");
  assert(result.shouldRegenerateDesign, "design must be marked for regeneration");
  assert(Boolean(updated!.final_instagram_caption), "final caption must exist");
  assert(updated!.status === "draft", "draft must not be published automatically");
  assert(result.availableActions.includes("approve"), "approve action should remain available");

  console.log("test:draft-instructions passed");
}

main().catch((error) => {
  console.error(`test:draft-instructions failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

