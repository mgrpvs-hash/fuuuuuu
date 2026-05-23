import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { Context, Markup, Telegraf } from "telegraf";

import { env } from "../config/env.js";
import { AppDatabase } from "../db/database.js";
import { ContentWorkflowService } from "../services/content-workflow.service.js";
import { MediaValidationService } from "../services/media-validation.service.js";
import { OpenAiService } from "../services/openai.service.js";
import { RateLimitService } from "../services/rate-limit.service.js";
import { SafetyService } from "../services/safety.service.js";
import { ContentType, Language, MediaType } from "../types/domain.js";
import { AppError, toAppError } from "../types/errors.js";
import { ensureDir } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

type DraftSession = {
  mediaItemId: number;
  mediaType: MediaType;
  description?: string;
  contentType?: ContentType;
  language?: Language;
  awaitingScheduleForContentId?: number;
};

const botLogger = logger.child({ component: "telegram-bot" });

function getUserId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

function getChatId(ctx: Context): number | null {
  return ctx.chat?.id ?? null;
}

function buildActionKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Approve now", `approve:${contentId}`),
      Markup.button.callback("Regenerate", `regenerate:${contentId}`)
    ],
    [
      Markup.button.callback("Schedule", `schedule:${contentId}`),
      Markup.button.callback("Cancel", `cancel:${contentId}`)
    ]
  ]);
}

function formatGeneratedPreview(payload: {
  contentId: number;
  captions: string[];
  hashtags: string[];
  cta: string;
  storyText: string;
  reelIdea?: string | null;
  riskWarning?: string | null;
  safeRewriteHint?: string | null;
}): string {
  return [
    `Draft #${payload.contentId}`,
    "",
    "Caption options:",
    ...payload.captions.map((caption, index) => `${index + 1}. ${caption}`),
    "",
    `CTA: ${payload.cta}`,
    "",
    `Hashtags: ${payload.hashtags.join(" ")}`,
    "",
    `Story text: ${payload.storyText}`,
    payload.reelIdea ? `\nReel idea: ${payload.reelIdea}` : "",
    payload.riskWarning ? `\nSafety warning: ${payload.riskWarning}` : "",
    payload.safeRewriteHint ? `\nSafer wording hint: ${payload.safeRewriteHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function safeReply(ctx: Context, text: string): Promise<void> {
  const chatId = getChatId(ctx);
  if (!chatId) {
    return;
  }
  await ctx.telegram.sendMessage(chatId, text);
}

function parseActionContentId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError("Invalid content id", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  return parsed;
}

export function createTelegramBot(input: {
  db: AppDatabase;
  aiService: OpenAiService;
  safetyService: SafetyService;
  workflowService: ContentWorkflowService;
  mediaValidationService: MediaValidationService;
  rateLimitService: RateLimitService;
}): Telegraf {
  const { db, aiService, safetyService, workflowService, mediaValidationService, rateLimitService } = input;
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  const draftSessions = new Map<number, DraftSession>();

  bot.use(async (ctx, next) => {
    const userId = getUserId(ctx);
    if (!userId) {
      return next();
    }
    const correlationId = logger.newCorrelationId();
    try {
      rateLimitService.check(`tg:${userId}`);
      botLogger.debug("Incoming update", {
        correlationId,
        userId,
        updateType: Object.keys(ctx.update)[0] ?? "unknown"
      });
      await next();
    } catch (error) {
      const appError = toAppError(error, "Unhandled bot middleware error");
      botLogger.warn("Middleware rejected update", {
        correlationId,
        userId,
        code: appError.code,
        message: appError.message
      });
      await safeReply(
        ctx,
        appError.code === "RATE_LIMITED"
          ? "Слишком много запросов. Подождите немного и попробуйте снова."
          : "Не удалось обработать запрос. Повторите попытку."
      );
    }
  });

  bot.start(async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    db.getOrCreateUser(userId);
    await ctx.reply(
      [
        "Привет! Я помогу подготовить безопасный медицинский контент для Instagram.",
        "1) Отправьте фото или видео",
        "2) Добавьте описание",
        "3) Выберите тип контента и язык",
        "4) Подтвердите публикацию (human approval обязателен)"
      ].join("\n")
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      [
        "/start - начать",
        "/help - помощь",
        "/settings - текущие настройки",
        "/set_tone <tone> - установить тон коммуникации",
        "/set_language <ru|en> - язык контента",
        "/connect_instagram <account_id> - привязать IG аккаунт",
        "/drafts - последние черновики",
        "/scheduled - запланированные публикации"
      ].join("\n")
    );
  });

  bot.command("settings", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const user = db.getUserByTelegramId(userId);
    await ctx.reply(
      `Tone: ${user.tone}\nLanguage: ${user.language}\nInstagram account id: ${user.instagram_account_id ?? "(env default)"}`
    );
  });

  bot.command("set_tone", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const tone = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!tone) {
      await ctx.reply("Usage: /set_tone professional|friendly|expert");
      return;
    }
    db.updateUserSetting(userId, "tone", tone);
    await ctx.reply(`Tone updated to: ${tone}`);
  });

  bot.command("set_language", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const language = ctx.message.text.split(" ")[1]?.trim().toLowerCase();
    if (language !== "ru" && language !== "en") {
      await ctx.reply("Usage: /set_language ru|en");
      return;
    }
    db.updateUserSetting(userId, "language", language);
    await ctx.reply(`Language updated to: ${language}`);
  });

  bot.command("connect_instagram", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const accountId = ctx.message.text.split(" ")[1]?.trim();
    if (!accountId) {
      await ctx.reply("Usage: /connect_instagram <instagram_business_account_id>");
      return;
    }
    db.setInstagramAccountId(userId, accountId);
    await ctx.reply("Instagram account id saved.");
  });

  bot.command("drafts", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const drafts = db.listDrafts(userId);
    if (!drafts.length) {
      await ctx.reply("No drafts yet.");
      return;
    }
    await ctx.reply(
      drafts
        .map((d) => `#${d.id} • ${d.content_type} • ${d.status} • ${d.created_at}`)
        .join("\n")
    );
  });

  bot.command("scheduled", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const schedules = db.listScheduled(userId);
    if (!schedules.length) {
      await ctx.reply("No scheduled posts.");
      return;
    }
    await ctx.reply(
      schedules
        .map((s) => `Schedule #${s.id} (draft #${s.generated_content_id}) • ${s.scheduled_at} • ${s.job_status}`)
        .join("\n")
    );
  });

  bot.on("photo", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (!photo) return;

    try {
      mediaValidationService.validateTelegramMetadata({
        mediaType: "image",
        fileSize: photo.file_size
      });

      const fileId = photo.file_id;
      const localPath = await downloadTelegramFile(bot, fileId, "image");
      await mediaValidationService.validateStoredFile(localPath, "image");
      const mediaItemId = db.createMediaItem({
        telegramUserId: userId,
        telegramFileId: fileId,
        mediaType: "image",
        localPath
      });

      draftSessions.set(userId, { mediaItemId, mediaType: "image", description: ctx.message.caption });
      await ctx.reply("Фото получено. Отправьте текстовое описание для поста.");
    } catch (error) {
      const appError = toAppError(error, "Photo processing failed");
      botLogger.warn("Photo intake failed", { userId, message: appError.message });
      await ctx.reply(`Ошибка обработки фото: ${appError.message}`);
    }
  });

  bot.on("video", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const video = ctx.message.video;
    if (!video) return;

    try {
      mediaValidationService.validateTelegramMetadata({
        mediaType: "video",
        mimeType: video.mime_type,
        fileSize: video.file_size,
        durationSeconds: video.duration
      });

      const fileId = video.file_id;
      const localPath = await downloadTelegramFile(bot, fileId, "video");
      await mediaValidationService.validateStoredFile(localPath, "video");

      const mediaItemId = db.createMediaItem({
        telegramUserId: userId,
        telegramFileId: fileId,
        mediaType: "video",
        localPath
      });

      draftSessions.set(userId, { mediaItemId, mediaType: "video", description: ctx.message.caption });
      await ctx.reply("Видео получено. Отправьте текстовое описание для контента.");
    } catch (error) {
      const appError = toAppError(error, "Video processing failed");
      botLogger.warn("Video intake failed", { userId, message: appError.message });
      await ctx.reply(`Ошибка обработки видео: ${appError.message}`);
    }
  });

  bot.on("text", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      return;
    }

    try {
      const session = draftSessions.get(userId);
      if (!session) {
        await ctx.reply("Сначала отправьте фото или видео.");
        return;
      }

      if (session.awaitingScheduleForContentId) {
        const parsed = dayjs(text);
        if (!parsed.isValid()) {
          await ctx.reply("Неверный формат даты. Пример: 2026-05-24 14:30");
          return;
        }

        const contentId = session.awaitingScheduleForContentId;
        db.getGeneratedContentByIdForTelegramUser(contentId, userId);
        workflowService.approveDraft(contentId);
        workflowService.scheduleDraft(contentId, parsed.toISOString());
        draftSessions.delete(userId);
        await ctx.reply("Публикация запланирована.");
        return;
      }

      session.description = text;
      draftSessions.set(userId, session);
      await ctx.reply(
        "Выберите тип контента:",
        Markup.inlineKeyboard([
          [
            Markup.button.callback("Post", "ctype:post"),
            Markup.button.callback("Reel", "ctype:reel"),
            Markup.button.callback("Story", "ctype:story")
          ]
        ])
      );
    } catch (error) {
      const appError = toAppError(error, "Text handling failed");
      await ctx.reply(`Ошибка обработки текста: ${appError.message}`);
    }
  });

  bot.action(/^ctype:(post|reel|story)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentType = ctx.match[1] as ContentType;
    const session = draftSessions.get(userId);
    if (!session) {
      await ctx.answerCbQuery("No active draft session");
      return;
    }
    session.contentType = contentType;
    draftSessions.set(userId, session);

    await ctx.answerCbQuery();
    await ctx.reply(
      "Выберите язык:",
      Markup.inlineKeyboard([[Markup.button.callback("RU", "lang:ru"), Markup.button.callback("EN", "lang:en")]])
    );
  });

  bot.action(/^lang:(ru|en)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const language = ctx.match[1] as Language;
    const session = draftSessions.get(userId);
    if (!session || !session.description || !session.contentType) {
      await ctx.answerCbQuery("Нет данных для генерации");
      return;
    }

    session.language = language;
    draftSessions.set(userId, session);
    await ctx.answerCbQuery();

    const user = db.getUserByTelegramId(userId);
    const inputSafety = safetyService.analyzeText(session.description);
    if (inputSafety.hasUnsafeClaims) {
      await ctx.reply(
        `Внимание: ${inputSafety.warningMessage}\nНайдены триггеры: ${inputSafety.blockedTerms.join(", ")}\nПредложение: ${inputSafety.saferTextSuggestion}`
      );
    }

    try {
      const generated = await aiService.generateMedicalSafeContent({
        language,
        contentType: session.contentType,
        tone: user.tone,
        description: session.description,
        hasVideo: session.mediaType === "video",
        hasImage: session.mediaType === "image",
        safetyNotes: inputSafety.hasUnsafeClaims ? inputSafety.blockedTerms : []
      });

      const contentId = db.createGeneratedContent({
        telegramUserId: userId,
        mediaItemId: session.mediaItemId,
        contentType: session.contentType,
        language,
        description: session.description,
        captions: generated.captions,
        hashtags: generated.hashtags,
        cta: generated.cta,
        storyText: generated.storyText,
        reelIdea: generated.reelIdea,
        riskWarning: generated.riskWarning,
        safeRewriteHint: generated.safeRewriteHint
      });
      db.selectCaption(contentId, generated.captions[0]);

      await ctx.reply(
        formatGeneratedPreview({
          contentId,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          reelIdea: generated.reelIdea,
          riskWarning: generated.riskWarning,
          safeRewriteHint: generated.safeRewriteHint
        }),
        buildActionKeyboard(contentId)
      );
    } catch (error) {
      const appError = toAppError(error, "Generation failed");
      botLogger.error("Generation failed", {
        userId,
        message: appError.message,
        code: appError.code
      });
      await ctx.reply(`Ошибка генерации: ${appError.message}`);
    }
  });

  bot.action(/^approve:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    await ctx.answerCbQuery("Publishing...");

    try {
      db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      workflowService.approveDraft(contentId);
      const result = await workflowService.publishDraftNow(contentId);
      await ctx.reply(result.success ? "Опубликовано в Instagram." : `Ошибка публикации: ${result.message}`);
    } catch (error) {
      const appError = toAppError(error, "Approve/publish failed");
      await ctx.reply(`Ошибка approve: ${appError.message}`);
    }
  });

  bot.action(/^regenerate:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);

    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const media = db.getMediaItemById(draft.media_item_id);
      if (!media) {
        throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
      }

      draftSessions.set(userId, {
        mediaItemId: media.id,
        mediaType: media.media_type,
        description: draft.description,
        contentType: draft.content_type,
        language: draft.language
      });
      await ctx.answerCbQuery();
      await ctx.reply("Запускаю новую генерацию...");

      const inputSafety = safetyService.analyzeText(draft.description);
      const user = db.getUserByTelegramId(userId);
      const generated = await aiService.generateMedicalSafeContent({
        language: draft.language,
        contentType: draft.content_type,
        tone: user.tone,
        description: draft.description,
        hasVideo: media.media_type === "video",
        hasImage: media.media_type === "image",
        safetyNotes: inputSafety.blockedTerms
      });

      const newContentId = db.createGeneratedContent({
        telegramUserId: userId,
        mediaItemId: media.id,
        contentType: draft.content_type,
        language: draft.language,
        description: draft.description,
        captions: generated.captions,
        hashtags: generated.hashtags,
        cta: generated.cta,
        storyText: generated.storyText,
        reelIdea: generated.reelIdea,
        riskWarning: generated.riskWarning,
        safeRewriteHint: generated.safeRewriteHint
      });
      db.selectCaption(newContentId, generated.captions[0]);
      await ctx.reply(
        formatGeneratedPreview({
          contentId: newContentId,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          reelIdea: generated.reelIdea,
          riskWarning: generated.riskWarning,
          safeRewriteHint: generated.safeRewriteHint
        }),
        buildActionKeyboard(newContentId)
      );
    } catch (error) {
      const appError = toAppError(error, "Regenerate failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка регенерации: ${appError.message}`);
    }
  });

  bot.action(/^schedule:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);

    try {
      db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const session = draftSessions.get(userId) ?? { mediaItemId: 0, mediaType: "image" as MediaType };
      session.awaitingScheduleForContentId = contentId;
      draftSessions.set(userId, session);
      await ctx.answerCbQuery();
      await ctx.reply("Введите дату и время публикации (пример: 2026-05-24 14:30)");
    } catch (error) {
      const appError = toAppError(error, "Schedule preparation failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка планирования: ${appError.message}`);
    }
  });

  bot.action(/^cancel:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);

    try {
      db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      db.updateGeneratedStatus(contentId, "failed");
      draftSessions.delete(userId);
      await ctx.answerCbQuery();
      await ctx.reply("Операция отменена.");
    } catch (error) {
      const appError = toAppError(error, "Cancel failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка отмены: ${appError.message}`);
    }
  });

  bot.catch(async (error, ctx) => {
    const appError = toAppError(error, "Unhandled Telegram error");
    botLogger.error("Telegram bot uncaught error", {
      code: appError.code,
      statusCode: appError.statusCode,
      message: appError.message,
      details: appError.details
    });
    await safeReply(ctx, "Внутренняя ошибка. Попробуйте снова позже.");
  });

  return bot;
}

async function downloadTelegramFile(bot: Telegraf, fileId: string, mediaType: MediaType): Promise<string> {
  const fileUrl = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.toString());
  if (!response.ok) {
    throw new AppError(`Failed downloading Telegram file: ${response.status}`, {
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: response.status
    });
  }

  const extension = mediaType === "image" ? "jpg" : "mp4";
  const mediaDir = path.resolve(process.cwd(), "media");
  await ensureDir(mediaDir);
  const filePath = path.resolve(mediaDir, `${Date.now()}-${fileId}.${extension}`);
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}
