import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { Context, Markup, Telegraf } from "telegraf";

import { env } from "../config/env.js";
import { AppDatabase, DbMediaItem } from "../db/database.js";
import { formatInstagramCaption } from "../services/caption-formatter.service.js";
import { ContentWorkflowService } from "../services/content-workflow.service.js";
import { MediaDesignService } from "../services/media-design.service.js";
import { MediaValidationService } from "../services/media-validation.service.js";
import { OpenAiService } from "../services/openai.service.js";
import { RateLimitService } from "../services/rate-limit.service.js";
import { SafetyService } from "../services/safety.service.js";
import { StorageService } from "../services/storage.service.js";
import { VideoDesignService } from "../services/video-design.service.js";
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

type GeneratedPayload = {
  contentType: ContentType;
  language: Language;
  captions: string[];
  hashtags: string[];
  cta: string;
  storyText: string;
  reelIdea?: string | null;
  riskWarning?: string | null;
  safeRewriteHint?: string | null;
};

const botLogger = logger.child({ component: "telegram-bot" });

function getUserId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

function getChatId(ctx: Context): number | null {
  return ctx.chat?.id ?? null;
}

function getIncomingText(ctx: Context): string {
  if ("message" in ctx.update && ctx.update.message && "text" in ctx.update.message) {
    return String(ctx.update.message.text ?? "");
  }
  return "";
}

function userAllowed(userId: number): boolean {
  if (!env.TELEGRAM_ALLOWED_USER_IDS_LIST.length) {
    return true;
  }
  return env.TELEGRAM_ALLOWED_USER_IDS_LIST.includes(userId);
}

function parseActionContentId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError("Invalid content id", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  return parsed;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function deriveVisualTitle(language: Language, selectedCaption: string): string {
  const normalized = selectedCaption.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return language === "en" ? "Modern equipment at our clinic" : "Современное оборудование в клинике";
  }
  const firstSentence = normalized.split(/[.!?]/)[0]?.trim() ?? normalized;
  return firstSentence.slice(0, 90);
}

function buildActionKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Approve", `approve:${contentId}`),
      Markup.button.callback("Regenerate text", `regenerate_text:${contentId}`)
    ],
    [
      Markup.button.callback("Regenerate design", `regenerate_design:${contentId}`),
      Markup.button.callback("Use original photo", `use_original:${contentId}`)
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
  finalCaption: string;
  captionWarning?: string;
  designWarning?: string;
  useOriginalMedia: boolean;
}): string {
  return [
    `Draft #${payload.contentId}`,
    payload.useOriginalMedia ? "⚠️ Будет опубликовано исходное фото без дизайна." : "",
    payload.designWarning ? `⚠️ ${payload.designWarning}` : "",
    payload.captionWarning ? `⚠️ ${payload.captionWarning}` : "",
    "",
    "Caption options:",
    ...payload.captions.map((caption, index) => `${index + 1}. ${caption}`),
    "",
    `CTA: ${payload.cta}`,
    "",
    `Hashtags: ${payload.hashtags.join(" ")}`,
    payload.reelIdea ? `\nReel idea: ${payload.reelIdea}` : "",
    payload.riskWarning ? `\nSafety warning: ${payload.riskWarning}` : "",
    payload.safeRewriteHint ? `\nSafer wording hint: ${payload.safeRewriteHint}` : "",
    payload.storyText ? `\nStory text: ${payload.storyText}` : "",
    "",
    "Текст, который будет опубликован в Instagram:",
    payload.finalCaption
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

async function sendPreviewPhotoIfExists(ctx: Context, previewPath: string | null): Promise<void> {
  if (!previewPath) {
    return;
  }
  const chatId = getChatId(ctx);
  if (!chatId) {
    return;
  }

  try {
    const source = await fs.readFile(previewPath);
    await ctx.telegram.sendPhoto(chatId, { source }, { caption: "Processed preview" });
  } catch (error) {
    const appError = toAppError(error, "Preview upload failed");
    await safeReply(ctx, `Не удалось отправить preview: ${appError.message}`);
  }
}

export function createTelegramBot(input: {
  db: AppDatabase;
  aiService: OpenAiService;
  safetyService: SafetyService;
  workflowService: ContentWorkflowService;
  mediaValidationService: MediaValidationService;
  storageService: StorageService;
  mediaDesignService: MediaDesignService;
  videoDesignService: VideoDesignService;
  rateLimitService: RateLimitService;
}): Telegraf {
  const {
    db,
    aiService,
    safetyService,
    workflowService,
    mediaValidationService,
    storageService,
    mediaDesignService,
    videoDesignService,
    rateLimitService
  } = input;

  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  const draftSessions = new Map<number, DraftSession>();

  const prepareMediaDesignAndPreview = async (args: {
    ctx: Context;
    contentId: number;
    media: DbMediaItem;
    payload: GeneratedPayload;
    forceUseOriginal?: boolean;
  }): Promise<{ finalCaption: string; captionWarning?: string; designWarning?: string; useOriginalMedia: boolean }> => {
    const selectedCaption = args.payload.captions[0] ?? "";
    db.selectCaption(args.contentId, selectedCaption);

    const formatted = formatInstagramCaption({
      selectedCaption,
      cta: args.payload.cta,
      hashtags: args.payload.hashtags,
      contentType: args.payload.contentType
    });
    db.setFinalInstagramCaption(args.contentId, formatted.caption);
    db.setUseOriginalMedia(args.contentId, args.forceUseOriginal ? true : false);

    let designWarning: string | undefined;
    let useOriginalMedia = Boolean(args.forceUseOriginal);
    let previewPath: string | null = null;

    if (!useOriginalMedia) {
      try {
        if (args.media.media_type === "image") {
          const imageDesign = await mediaDesignService.createBrandedPostImage({
            sourcePath: args.media.local_path,
            language: args.payload.language,
            title: deriveVisualTitle(args.payload.language, selectedCaption)
          });
          const uploaded = await storageService.uploadMediaFromLocal({
            localPath: imageDesign.outputPath,
            mediaType: "image"
          });
          db.updateMediaDesignResult({
            mediaItemId: args.media.id,
            storageUrlProcessed: uploaded.publicUrl,
            processedMediaPath: imageDesign.outputPath,
            mediaProcessingStatus: "processed",
            mediaDesignVersion: imageDesign.designVersion
          });
          previewPath = imageDesign.outputPath;
        } else {
          const videoDesign = await videoDesignService.createStyledReel({
            sourcePath: args.media.local_path,
            language: args.payload.language,
            title: deriveVisualTitle(args.payload.language, selectedCaption)
          });
          const uploaded = await storageService.uploadMediaFromLocal({
            localPath: videoDesign.outputPath,
            mediaType: "video"
          });
          db.updateMediaDesignResult({
            mediaItemId: args.media.id,
            storageUrlProcessed: uploaded.publicUrl,
            processedMediaPath: videoDesign.outputPath,
            mediaProcessingStatus: "processed",
            mediaDesignVersion: videoDesign.designVersion
          });
          previewPath = videoDesign.coverImagePath;
          designWarning = videoDesign.warning;
        }
      } catch (error) {
        const appError = toAppError(error, "Media design processing failed");
        db.updateMediaDesignResult({
          mediaItemId: args.media.id,
          mediaProcessingStatus: "failed"
        });
        db.setUseOriginalMedia(args.contentId, true);
        useOriginalMedia = true;
        designWarning = `Не удалось создать дизайн: ${appError.message}`;
      }
    }

    await sendPreviewPhotoIfExists(args.ctx, previewPath);
    return {
      finalCaption: formatted.caption,
      captionWarning: formatted.warning,
      designWarning,
      useOriginalMedia
    };
  };

  const sendDraftPreview = async (args: {
    ctx: Context;
    contentId: number;
    media: DbMediaItem;
    payload: GeneratedPayload;
    forceUseOriginal?: boolean;
  }): Promise<void> => {
    const designResult = await prepareMediaDesignAndPreview(args);
    await args.ctx.reply(
      formatGeneratedPreview({
        contentId: args.contentId,
        captions: args.payload.captions,
        hashtags: args.payload.hashtags,
        cta: args.payload.cta,
        storyText: args.payload.storyText,
        reelIdea: args.payload.reelIdea,
        riskWarning: args.payload.riskWarning,
        safeRewriteHint: args.payload.safeRewriteHint,
        finalCaption: designResult.finalCaption,
        captionWarning: designResult.captionWarning,
        designWarning: designResult.designWarning,
        useOriginalMedia: designResult.useOriginalMedia
      }),
      buildActionKeyboard(args.contentId)
    );
  };

  bot.use(async (ctx, next) => {
    const userId = getUserId(ctx);
    if (!userId) {
      return next();
    }

    const incomingText = getIncomingText(ctx).trim();
    const isWhoamiCommand = incomingText.startsWith("/whoami");

    if (!userAllowed(userId) && !isWhoamiCommand) {
      await safeReply(ctx, `Access denied. Your Telegram ID is: ${userId}`);
      return;
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
          ? "Too many requests. Please retry shortly."
          : "Could not process request. Please retry."
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
        "4) Подтвердите публикацию вручную (human approval)"
      ].join("\n")
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      [
        "/start",
        "/help",
        "/health",
        "/whoami",
        "/settings",
        "/set_tone <tone>",
        "/set_language <ru|en>",
        "/connect_instagram <account_id>",
        "/drafts",
        "/scheduled"
      ].join("\n")
    );
  });

  bot.command("health", async (ctx) => {
    const allowedConfigured = env.TELEGRAM_ALLOWED_USER_IDS_LIST.length > 0 ? "yes" : "no";
    await ctx.reply(
      [
        "Telegram OK",
        `Mode: ${env.TELEGRAM_MODE}`,
        `Allowed user IDs configured: ${allowedConfigured}`
      ].join("\n")
    );
  });

  bot.command("whoami", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const username = ctx.from?.username ? `@${ctx.from.username}` : "(no username)";
    await ctx.reply(
      `Telegram user id: ${userId}\nUsername: ${username}\nAllowed: ${userAllowed(userId) ? "yes" : "no"}`
    );
  });

  bot.command("settings", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const user = db.getUserByTelegramId(userId);
    await ctx.reply(
      `Tone: ${user.tone}\nLanguage: ${user.language}\nInstagram account id: ${user.instagram_account_id ?? env.INSTAGRAM_BUSINESS_ACCOUNT_ID}`
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
      const localPath = await downloadTelegramFile(bot, photo.file_id, "image");
      await mediaValidationService.validateStoredFile(localPath, "image");
      const uploaded = await storageService.uploadMediaFromLocal({
        localPath,
        mediaType: "image"
      });
      const mediaItemId = db.createMediaItem({
        telegramUserId: userId,
        telegramFileId: photo.file_id,
        mediaType: "image",
        localPath,
        storageUrlOriginal: uploaded.publicUrl
      });
      draftSessions.set(userId, { mediaItemId, mediaType: "image", description: ctx.message.caption });
      await ctx.reply("Фото получено и загружено в storage. Отправьте текстовое описание для поста.");
    } catch (error) {
      const appError = toAppError(error, "Photo processing failed");
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
      const localPath = await downloadTelegramFile(bot, video.file_id, "video");
      await mediaValidationService.validateStoredFile(localPath, "video");
      const uploaded = await storageService.uploadMediaFromLocal({
        localPath,
        mediaType: "video"
      });
      const mediaItemId = db.createMediaItem({
        telegramUserId: userId,
        telegramFileId: video.file_id,
        mediaType: "video",
        localPath,
        storageUrlOriginal: uploaded.publicUrl
      });
      draftSessions.set(userId, { mediaItemId, mediaType: "video", description: ctx.message.caption });
      await ctx.reply("Видео получено и загружено в storage. Отправьте текстовое описание для контента.");
    } catch (error) {
      const appError = toAppError(error, "Video processing failed");
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
    const session = draftSessions.get(userId);
    if (!session) {
      await ctx.answerCbQuery("No active draft session");
      return;
    }
    session.contentType = ctx.match[1] as ContentType;
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
    const session = draftSessions.get(userId);
    if (!session || !session.description || !session.contentType) {
      await ctx.answerCbQuery("Нет данных для генерации");
      return;
    }

    const language = ctx.match[1] as Language;
    const user = db.getUserByTelegramId(userId);
    await ctx.answerCbQuery();

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

      const media = db.getMediaItemById(session.mediaItemId);
      if (!media) {
        throw new AppError("Media not found for draft session", {
          code: "NOT_FOUND",
          statusCode: 404
        });
      }

      await sendDraftPreview({
        ctx,
        contentId,
        media,
        payload: {
          contentType: session.contentType,
          language,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          reelIdea: generated.reelIdea,
          riskWarning: generated.riskWarning,
          safeRewriteHint: generated.safeRewriteHint
        }
      });
    } catch (error) {
      const appError = toAppError(error, "Generation failed");
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
      await ctx.reply(result.success ? "Published successfully" : `Ошибка публикации: ${result.message}`);
    } catch (error) {
      const appError = toAppError(error, "Approve/publish failed");
      await ctx.reply(`Ошибка approve: ${appError.message}`);
    }
  });

  bot.action(/^regenerate(?:_text)?:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const media = db.getMediaItemById(draft.media_item_id);
      if (!media) {
        throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
      }

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
      await ctx.answerCbQuery();
      await sendDraftPreview({
        ctx,
        contentId: newContentId,
        media,
        payload: {
          contentType: draft.content_type,
          language: draft.language,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          reelIdea: generated.reelIdea,
          riskWarning: generated.riskWarning,
          safeRewriteHint: generated.safeRewriteHint
        }
      });
    } catch (error) {
      const appError = toAppError(error, "Regenerate failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка регенерации: ${appError.message}`);
    }
  });

  bot.action(/^regenerate_design:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const media = db.getMediaItemById(draft.media_item_id);
      if (!media) {
        throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
      }
      await ctx.answerCbQuery("Design regenerating...");
      await sendDraftPreview({
        ctx,
        contentId: draft.id,
        media,
        payload: {
          contentType: draft.content_type,
          language: draft.language,
          captions: parseJsonStringArray(draft.captions_json),
          hashtags: parseJsonStringArray(draft.hashtags_json),
          cta: draft.cta,
          storyText: draft.story_text,
          reelIdea: draft.reel_idea,
          riskWarning: draft.risk_warning,
          safeRewriteHint: draft.safe_rewrite_hint
        }
      });
    } catch (error) {
      const appError = toAppError(error, "Regenerate design failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка regenerate design: ${appError.message}`);
    }
  });

  bot.action(/^use_original:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      db.setUseOriginalMedia(contentId, true);
      await ctx.answerCbQuery();
      const finalCaption = draft.final_instagram_caption ?? draft.selected_caption ?? "";
      await ctx.reply(
        [
          "Будет опубликовано исходное фото без дизайна.",
          "",
          "Текст, который будет опубликован в Instagram:",
          finalCaption
        ].join("\n"),
        buildActionKeyboard(contentId)
      );
    } catch (error) {
      const appError = toAppError(error, "Use original failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка выбора оригинала: ${appError.message}`);
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
      message: appError.message
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

