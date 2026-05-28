import dayjs from "dayjs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Context, Markup, Telegraf } from "telegraf";

import { env } from "../config/env.js";
import { AppDatabase, DbGeneratedContent, DbMediaItem } from "../db/database.js";
import { AssistantCommandService } from "../services/assistant-command.service.js";
import { formatInstagramCaption } from "../services/caption-formatter.service.js";
import { ContentWorkflowService } from "../services/content-workflow.service.js";
import { DesignSelectionService } from "../services/design-selection.service.js";
import {
  MEDIA_DESIGN_VARIANTS,
  MediaDesignService,
  MediaDesignVariant
} from "../services/media-design.service.js";
import { MediaValidationService } from "../services/media-validation.service.js";
import { OpenAiService } from "../services/openai.service.js";
import { RateLimitService } from "../services/rate-limit.service.js";
import { SafetyService } from "../services/safety.service.js";
import { StorageService } from "../services/storage.service.js";
import {
  TEXT_POSTER_STYLE_VARIANTS,
  TextPosterDesignService,
  TextPosterStyleVariant
} from "../services/text-poster-design.service.js";
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
  activeDraftContentId?: number;
  preferredStyle?: MediaDesignVariant;
  preferredPosterStyle?: TextPosterStyleVariant;
};

type GeneratedPayload = {
  contentType: ContentType;
  language: Language;
  captions: string[];
  hashtags: string[];
  cta: string;
  storyText: string;
  visualTitle?: string | null;
  visualSubtitle?: string | null;
  designHint?: string | null;
  bulletPoints?: string[];
  reelIdea?: string | null;
  riskWarning?: string | null;
  safeRewriteHint?: string | null;
};

const botLogger = logger.child({ component: "telegram-bot" });

const STYLE_LABELS: Record<MediaDesignVariant, string> = {
  clean_light: "Clean",
  premium_card: "Premium",
  equipment_focus: "Equipment",
  announcement: "Announcement",
  educational: "Educational",
  minimal_storylike: "Minimal",
  split_layout: "Split",
  full_bleed_blur: "Blur"
};

const POSTER_STYLE_LABELS: Record<TextPosterStyleVariant, string> = {
  morning_health: "Morning health",
  medical_tip: "Medical tip",
  clinic_announcement: "Announcement",
  minimalist_quote: "Minimalist",
  service_card: "Service card",
  educational_card: "Educational"
};

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
    return language === "en" ? "Modern care space" : "Современное пространство для ухода";
  }
  const firstSentence = normalized.split(/[.!?]/)[0]?.trim() ?? normalized;
  return firstSentence.slice(0, 70);
}

function buildActionKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Approve", `approve:${contentId}`),
      Markup.button.callback("Regenerate text", `regenerate_text:${contentId}`)
    ],
    [
      Markup.button.callback("Regenerate design", `regenerate_design:${contentId}`),
      Markup.button.callback("Change style", `change_style:${contentId}`)
    ],
    [
      Markup.button.callback("Shorter caption", `caption_shorter:${contentId}`),
      Markup.button.callback("More professional", `caption_professional:${contentId}`)
    ],
    [
      Markup.button.callback("Remove hashtags", `caption_nohashtags:${contentId}`),
      Markup.button.callback("Use original photo", `use_original:${contentId}`)
    ],
    [
      Markup.button.callback("Schedule", `schedule:${contentId}`),
      Markup.button.callback("Cancel", `cancel:${contentId}`)
    ]
  ]);
}

function buildStyleKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Clean", `stylepick:${contentId}:clean_light`),
      Markup.button.callback("Premium", `stylepick:${contentId}:premium_card`),
      Markup.button.callback("Equipment", `stylepick:${contentId}:equipment_focus`)
    ],
    [
      Markup.button.callback("Announcement", `stylepick:${contentId}:announcement`),
      Markup.button.callback("Educational", `stylepick:${contentId}:educational`),
      Markup.button.callback("Minimal", `stylepick:${contentId}:minimal_storylike`)
    ],
    [
      Markup.button.callback("Split", `stylepick:${contentId}:split_layout`),
      Markup.button.callback("Blur", `stylepick:${contentId}:full_bleed_blur`)
    ]
  ]);
}

function buildPosterStyleKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Morning health", `posterstyle:${contentId}:morning_health`),
      Markup.button.callback("Medical tip", `posterstyle:${contentId}:medical_tip`)
    ],
    [
      Markup.button.callback("Announcement", `posterstyle:${contentId}:clinic_announcement`),
      Markup.button.callback("Minimalist", `posterstyle:${contentId}:minimalist_quote`)
    ],
    [
      Markup.button.callback("Service", `posterstyle:${contentId}:service_card`),
      Markup.button.callback("Educational", `posterstyle:${contentId}:educational_card`)
    ]
  ]);
}

function buildDesignFailureKeyboard(contentId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Try design again", `regenerate_design:${contentId}`),
      Markup.button.callback("Use original photo", `use_original:${contentId}`)
    ],
    [Markup.button.callback("Cancel", `cancel:${contentId}`)]
  ]);
}

function formatCaptionOnlyPreview(payload: {
  contentId: number;
  finalCaption: string;
  captionWarning?: string;
  useOriginalMedia: boolean;
}): string {
  return [
    `Draft #${payload.contentId}`,
    payload.useOriginalMedia ? "⚠️ Будет опубликовано исходное фото без дизайна." : "",
    payload.captionWarning ? `⚠️ ${payload.captionWarning}` : "",
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

async function sendPreviewPhoto(
  ctx: Context,
  previewPath: string | null,
  variant?: MediaDesignVariant | TextPosterStyleVariant
): Promise<void> {
  if (!previewPath) {
    return;
  }
  const chatId = getChatId(ctx);
  if (!chatId) return;

  try {
    const source = await fs.readFile(previewPath);
    const variantText = variant ? ` — variant: ${variant}` : "";
    await ctx.telegram.sendPhoto(chatId, { source }, { caption: `Processed preview${variantText}` });
  } catch (error) {
    const appError = toAppError(error, "Preview upload failed");
    await safeReply(ctx, `Не удалось отправить preview: ${appError.message}`);
  }
}

async function inspectSourcePath(localPath: string): Promise<{ exists: boolean; fileSize: number }> {
  if (!localPath || /^https?:\/\//i.test(localPath)) {
    return { exists: false, fileSize: 0 };
  }
  if (!fsSync.existsSync(localPath)) {
    return { exists: false, fileSize: 0 };
  }
  const stat = await fs.stat(localPath);
  return { exists: true, fileSize: stat.size };
}

async function detectMediaOrientation(media: DbMediaItem): Promise<"portrait" | "landscape" | "square" | "unknown"> {
  try {
    const metadata = await sharp(media.local_path).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) {
      return "unknown";
    }
    const ratio = width / height;
    if (ratio > 1.05) return "landscape";
    if (ratio < 0.95) return "portrait";
    return "square";
  } catch {
    return "unknown";
  }
}

function isGeneratedPosterMedia(media: DbMediaItem): boolean {
  return media.telegram_file_id.startsWith("generated-poster:");
}

function mapDesignHintToVariant(hint?: string | null): MediaDesignVariant | null {
  if (!hint) return null;
  const normalized = hint.trim().toLowerCase();
  if (MEDIA_DESIGN_VARIANTS.includes(normalized as MediaDesignVariant)) {
    return normalized as MediaDesignVariant;
  }
  return null;
}

function chooseStyleFromText(text: string): MediaDesignVariant | null {
  const normalized = text.toLowerCase();
  if (/premium|премиал/.test(normalized)) return "premium_card";
  if (/equipment|оборуд|аппарат/.test(normalized)) return "equipment_focus";
  if (/announce|анонс|новый врач|новая/.test(normalized)) return "announcement";
  if (/education|образоват|совет/.test(normalized)) return "educational";
  if (/minimal|миним/.test(normalized)) return "minimal_storylike";
  if (/split|раздел/.test(normalized)) return "split_layout";
  if (/blur|фон/.test(normalized)) return "full_bleed_blur";
  if (/clean|light|чист/.test(normalized)) return "clean_light";
  return null;
}

function choosePosterStyleFromText(text: string): TextPosterStyleVariant | undefined {
  const normalized = text.toLowerCase();
  if (/утро|morning|витамин/.test(normalized)) return "morning_health";
  if (/анонс|новост|announcement|врач/.test(normalized)) return "clinic_announcement";
  if (/миним|minimal|quote|цитат|премиаль/.test(normalized)) return "minimalist_quote";
  if (/услуг|service/.test(normalized)) return "service_card";
  if (/образоват|инфограф|education/.test(normalized)) return "educational_card";
  if (/совет|tip/.test(normalized)) return "medical_tip";
  return undefined;
}

function pickNextPosterVariant(previous?: string | null): TextPosterStyleVariant {
  if (!previous) {
    return "medical_tip";
  }
  const index = TEXT_POSTER_STYLE_VARIANTS.indexOf(previous as TextPosterStyleVariant);
  if (index < 0) {
    return "medical_tip";
  }
  return TEXT_POSTER_STYLE_VARIANTS[(index + 1) % TEXT_POSTER_STYLE_VARIANTS.length];
}

function extractHashtags(caption: string): string[] {
  return caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

function removeHashtagsFromCaption(caption: string): string {
  return caption
    .replace(/\s*#[\p{L}\p{N}_]+/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shortenCaptionText(caption: string): string {
  const hashtags = extractHashtags(caption);
  const withoutTags = removeHashtagsFromCaption(caption);
  const target = Math.max(280, Math.floor(withoutTags.length * 0.68));
  const shortened = withoutTags.length > target ? `${withoutTags.slice(0, target).trimEnd()}…` : withoutTags;
  return [shortened, hashtags.join(" ")].filter(Boolean).join("\n\n").trim();
}

function makeCaptionMoreProfessional(caption: string): string {
  return caption
    .replace(/крутой|супер|вау|wow/gi, "профессиональный")
    .replace(/приходите прямо сейчас/gi, "запишитесь на консультацию")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePosterMedicalText(input: { caption: string; language: Language; userPrompt: string }): string {
  let text = input.caption
    .replace(/100%\s*результат/gi, "")
    .replace(/гарант\w*/gi, "")
    .replace(/без\s*риска/gi, "")
    .replace(/полностью\s*вылеч\w*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/пейте\s+витамины|take vitamins/i.test(`${text} ${input.userPrompt}`)) {
    const suffix =
      input.language === "en"
        ? "Supplement and vitamin intake is best discussed with a specialist."
        : "Приём добавок и витаминов лучше обсуждать со специалистом.";
    if (!new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
      text = `${text}\n\n${suffix}`.trim();
    }
  }

  return text;
}

function mapPosterHintToVariant(hint?: string | null): TextPosterStyleVariant | undefined {
  if (!hint) return undefined;
  const normalized = hint.trim().toLowerCase();
  if (TEXT_POSTER_STYLE_VARIANTS.includes(normalized as TextPosterStyleVariant)) {
    return normalized as TextPosterStyleVariant;
  }
  return undefined;
}

export function createTelegramBot(input: {
  db: AppDatabase;
  aiService: OpenAiService;
  safetyService: SafetyService;
  workflowService: ContentWorkflowService;
  mediaValidationService: MediaValidationService;
  storageService: StorageService;
  mediaDesignService: MediaDesignService;
  textPosterDesignService: TextPosterDesignService;
  videoDesignService: VideoDesignService;
  designSelectionService: DesignSelectionService;
  assistantCommandService: AssistantCommandService;
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
    textPosterDesignService,
    videoDesignService,
    designSelectionService,
    assistantCommandService,
    rateLimitService
  } = input;

  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  const draftSessions = new Map<number, DraftSession>();

  const setActiveDraftForUser = (userId: number, contentId: number, mediaItemId: number, mediaType: MediaType) => {
    const current = draftSessions.get(userId) ?? { mediaItemId, mediaType };
    current.mediaItemId = mediaItemId;
    current.mediaType = mediaType;
    current.activeDraftContentId = contentId;
    draftSessions.set(userId, current);
  };

  const applyFinalCaption = (draft: DbGeneratedContent, payload: GeneratedPayload): { finalCaption: string; warning?: string; hashtags: string[] } => {
    const selectedCaption = payload.captions[0] ?? draft.selected_caption ?? "";
    db.selectCaption(draft.id, selectedCaption);
    const formatted = formatInstagramCaption({
      selectedCaption,
      cta: payload.cta,
      hashtags: payload.hashtags,
      contentType: payload.contentType
    });
    db.updateFinalCaptionAndHashtags({
      contentId: draft.id,
      finalCaption: formatted.caption,
      hashtags: formatted.hashtags,
      selectedCaption
    });
    return { finalCaption: formatted.caption, warning: formatted.warning, hashtags: formatted.hashtags };
  };

  const createTextPosterDraft = async (args: {
    ctx: Context;
    userId: number;
    prompt: string;
    preferredStyle?: TextPosterStyleVariant;
  }): Promise<void> => {
    const user = db.getUserByTelegramId(args.userId);
    await args.ctx.reply("Создаю визуал для Instagram...");

    const poster = await aiService.generateTextPosterContent({
      language: user.language,
      userPrompt: args.prompt
    });
    const safePosterCaption = sanitizePosterMedicalText({
      caption: poster.posterCaption,
      language: user.language,
      userPrompt: args.prompt
    });

    const posterDesign = await textPosterDesignService.createPoster({
      userPrompt: args.prompt,
      language: user.language,
      brandName: "MC Clinic Medical",
      brandHandle: "@mc_clinic.du",
      posterType: poster.posterType,
      styleVariant:
        args.preferredStyle ?? choosePosterStyleFromText(args.prompt) ?? mapPosterHintToVariant(poster.designHint),
      visualTitle: poster.visualTitle,
      visualSubtitle: poster.visualSubtitle,
      shortOverlayText: poster.shortOverlayText
    });

    const uploaded = await storageService.uploadMediaFromLocal({
      localPath: posterDesign.outputPath,
      mediaType: "image"
    });

    const mediaItemId = db.createMediaItem({
      telegramUserId: args.userId,
      telegramFileId: `generated-poster:${Date.now()}`,
      mediaType: "image",
      localPath: posterDesign.outputPath
    });
    db.updateMediaDesignResult({
      mediaItemId,
      storageUrlProcessed: uploaded.publicUrl,
      processedMediaPath: posterDesign.outputPath,
      mediaProcessingStatus: "processed",
      mediaDesignVersion: posterDesign.designVersion
    });

    const contentId = db.createGeneratedContent({
      telegramUserId: args.userId,
      mediaItemId,
      contentType: "post",
      language: user.language,
      description: args.prompt,
      captions: [safePosterCaption],
      hashtags: poster.hashtags,
      cta: poster.cta,
      storyText: "",
      visualTitle: poster.visualTitle,
      visualSubtitle: poster.visualSubtitle,
      designHint: poster.designHint
    });
    db.updateDesignMetadata({
      contentId,
      designVariant: posterDesign.variant,
      designSeed: `poster:${posterDesign.variant}:${Date.now()}`,
      incrementAttempt: true
    });

    const draft = db.getGeneratedContentById(contentId);
    if (!draft) {
      throw new AppError("Draft not found after poster creation", {
        code: "INTERNAL_ERROR",
        statusCode: 500
      });
    }

    const formatted = formatInstagramCaption({
      selectedCaption: safePosterCaption,
      cta: poster.cta,
      hashtags: poster.hashtags,
      contentType: "post"
    });
    db.selectCaption(contentId, safePosterCaption);
    db.updateFinalCaptionAndHashtags({
      contentId,
      finalCaption: formatted.caption,
      hashtags: formatted.hashtags,
      selectedCaption: safePosterCaption
    });
    db.setUseOriginalMedia(contentId, false);

    await sendPreviewPhoto(args.ctx, posterDesign.outputPath, undefined);
    await args.ctx.reply(
      formatCaptionOnlyPreview({
        contentId,
        finalCaption: formatted.caption,
        captionWarning: formatted.warning,
        useOriginalMedia: false
      }),
      buildActionKeyboard(contentId)
    );

    setActiveDraftForUser(args.userId, contentId, mediaItemId, "image");
  };

  const prepareMediaDesignAndPreview = async (args: {
    ctx: Context;
    contentId: number;
    media: DbMediaItem;
    payload: GeneratedPayload;
    forceUseOriginal?: boolean;
    preferredStyle?: MediaDesignVariant | TextPosterStyleVariant | null;
  }): Promise<{
    finalCaption: string;
    captionWarning?: string;
    useOriginalMedia: boolean;
    designFailed: boolean;
    designVariant?: MediaDesignVariant | TextPosterStyleVariant;
  }> => {
    const draft = db.getGeneratedContentById(args.contentId);
    if (!draft) {
      throw new AppError("Draft not found", { code: "NOT_FOUND", statusCode: 404 });
    }

    const captionResult = applyFinalCaption(draft, args.payload);
    db.setUseOriginalMedia(args.contentId, args.forceUseOriginal ? true : false);

    let useOriginalMedia = Boolean(args.forceUseOriginal);
    let designFailed = false;
    let previewPath: string | null = null;
    let designVariant: MediaDesignVariant | TextPosterStyleVariant | undefined;

    if (!useOriginalMedia) {
      const inputKind = /^https:\/\//i.test(args.media.local_path) ? "url" : "path";
      const sourcePathDebug = await inspectSourcePath(args.media.local_path);
      const orientation = await detectMediaOrientation(args.media);
      const preferredMediaStyle =
        args.preferredStyle && MEDIA_DESIGN_VARIANTS.includes(args.preferredStyle as MediaDesignVariant)
          ? (args.preferredStyle as MediaDesignVariant)
          : null;
      const selection = designSelectionService.chooseTemplate({
        contentType: args.payload.contentType,
        language: args.payload.language,
        description: draft.description,
        visualTitle: args.payload.visualTitle ?? undefined,
        previousVariant: (draft.design_variant as MediaDesignVariant | null) ?? null,
        orientation,
        preferredStyle: preferredMediaStyle ?? mapDesignHintToVariant(args.payload.designHint)
      });

      botLogger.info("media design input debug", {
        draftId: args.contentId,
        mediaItemId: args.media.id,
        input_kind: inputKind,
        input_path_exists: sourcePathDebug.exists ? "yes" : "no",
        input_file_size: sourcePathDebug.fileSize,
        orientation,
        selected_template: selection.templateId
      });

      try {
        if (args.media.media_type === "image") {
          if (isGeneratedPosterMedia(args.media)) {
            const posterStyleVariant =
              (args.preferredStyle as TextPosterStyleVariant | undefined) ??
              pickNextPosterVariant(draft.design_variant);
            const posterDesign = await textPosterDesignService.createPoster({
              userPrompt: draft.description,
              language: args.payload.language,
              brandName: "MC Clinic Medical",
              brandHandle: "@mc_clinic.du",
              posterType: args.payload.designHint ?? undefined,
              styleVariant: posterStyleVariant,
              visualTitle:
                args.payload.visualTitle ?? deriveVisualTitle(args.payload.language, draft.selected_caption ?? ""),
              visualSubtitle: args.payload.visualSubtitle ?? undefined,
              shortOverlayText: args.payload.captions[0] ?? undefined
            });
            designVariant = posterDesign.variant;
            const uploaded = await storageService.uploadMediaFromLocal({
              localPath: posterDesign.outputPath,
              mediaType: "image"
            });
            db.updateMediaDesignResult({
              mediaItemId: args.media.id,
              storageUrlProcessed: uploaded.publicUrl,
              processedMediaPath: posterDesign.outputPath,
              mediaProcessingStatus: "processed",
              mediaDesignVersion: posterDesign.designVersion
            });
            db.updateDesignMetadata({
              contentId: args.contentId,
              designVariant: posterDesign.variant,
              designSeed: `poster:${posterDesign.variant}:${Date.now()}`,
              incrementAttempt: true
            });
            previewPath = posterDesign.outputPath;
          } else {
            const imageDesign = await mediaDesignService.createBrandedPostImage({
              sourcePath: args.media.local_path,
              language: args.payload.language,
              title: args.payload.visualTitle ?? deriveVisualTitle(args.payload.language, draft.selected_caption ?? ""),
              subtitle: args.payload.visualSubtitle ?? undefined,
              bulletPoints: args.payload.bulletPoints,
              variant: (args.preferredStyle as MediaDesignVariant | undefined) ?? selection.templateId
            });
            designVariant = imageDesign.designVariant;
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
            db.updateDesignMetadata({
              contentId: args.contentId,
              designVariant: imageDesign.designVariant,
              designSeed: selection.seed,
              incrementAttempt: true
            });
            previewPath = imageDesign.outputPath;
            botLogger.info("media design output debug", {
              draftId: args.contentId,
              mediaItemId: args.media.id,
              input_kind: imageDesign.source.inputKind,
              input_path_exists: imageDesign.source.pathExists ? "yes" : "no",
              input_file_size: imageDesign.source.fileSize,
              original_image_width: imageDesign.source.width,
              original_image_height: imageDesign.source.height,
              design_variant: imageDesign.designVariant,
              output_width: imageDesign.output.width,
              output_height: imageDesign.output.height,
              output_file_size: imageDesign.output.fileSize,
              processed_image_path: imageDesign.outputPath,
              processed_image_uploaded: "yes",
              processed_media_url_exists: uploaded.publicUrl ? "yes" : "no",
              icon_enabled: imageDesign.layoutMetadata.iconEnabled ? "yes" : "no"
            });
          }
        } else {
          const videoDesign = await videoDesignService.createStyledReel({
            sourcePath: args.media.local_path,
            language: args.payload.language,
            title: args.payload.visualTitle ?? deriveVisualTitle(args.payload.language, draft.selected_caption ?? "")
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
          db.updateDesignMetadata({
            contentId: args.contentId,
            designVariant: "full_bleed_blur",
            designSeed: selection.seed,
            incrementAttempt: true
          });
          previewPath = videoDesign.coverImagePath;
          designVariant = "full_bleed_blur";
        }
      } catch (error) {
        const appError = toAppError(error, "Media design processing failed");
        db.updateMediaDesignResult({
          mediaItemId: args.media.id,
          mediaProcessingStatus: "failed"
        });
        db.setUseOriginalMedia(args.contentId, false);
        designFailed = true;
        botLogger.warn("media design failed", {
          draftId: args.contentId,
          mediaItemId: args.media.id,
          processed_image_uploaded: "no",
          processed_media_url_exists: "no",
          code: appError.code,
          message: appError.message
        });
      }
    }

    await sendPreviewPhoto(args.ctx, previewPath, designVariant);
    return {
      finalCaption: captionResult.finalCaption,
      captionWarning: captionResult.warning,
      useOriginalMedia,
      designFailed,
      designVariant
    };
  };

  const sendDraftPreview = async (args: {
    ctx: Context;
    userId: number;
    contentId: number;
    media: DbMediaItem;
    payload: GeneratedPayload;
    forceUseOriginal?: boolean;
    preferredStyle?: MediaDesignVariant | TextPosterStyleVariant | null;
  }): Promise<void> => {
    const designResult = await prepareMediaDesignAndPreview(args);
    setActiveDraftForUser(args.userId, args.contentId, args.media.id, args.media.media_type);

    if (designResult.designFailed) {
      await args.ctx.reply(
        "Не удалось создать дизайн изображения. Можно использовать оригинал или попробовать снова.",
        buildDesignFailureKeyboard(args.contentId)
      );
      return;
    }

    await args.ctx.reply(
      formatCaptionOnlyPreview({
        contentId: args.contentId,
        finalCaption: designResult.finalCaption,
        captionWarning: designResult.captionWarning,
        useOriginalMedia: designResult.useOriginalMedia
      }),
      buildActionKeyboard(args.contentId)
    );
  };

  const getDraftPayload = (draft: DbGeneratedContent): GeneratedPayload => ({
    contentType: draft.content_type,
    language: draft.language,
    captions: parseJsonStringArray(draft.captions_json),
    hashtags: parseJsonStringArray(draft.hashtags_json),
    cta: draft.cta,
    storyText: draft.story_text,
    visualTitle: draft.visual_title,
    visualSubtitle: draft.visual_subtitle,
    designHint: draft.design_hint,
    bulletPoints: [],
    reelIdea: draft.reel_idea,
    riskWarning: draft.risk_warning,
    safeRewriteHint: draft.safe_rewrite_hint
  });

  const handleAssistantChat = async (ctx: Context, userId: number, text: string): Promise<void> => {
    const user = db.getUserByTelegramId(userId);
    if (assistantCommandService.isMedicalAdviceQuestion(text)) {
      await ctx.reply(assistantCommandService.buildMedicalSafetyReply(user.language));
      return;
    }

    const intent = assistantCommandService.classify(text);
    if (intent.type === "approve_intent") {
      await ctx.reply("Подтвердите публикацию кнопкой Approve.");
      return;
    }
    if (intent.type === "generate_ideas") {
      const ideas = await aiService.generateIdeas({ language: user.language, count: 10 });
      await ctx.reply(ideas);
      return;
    }
    if (intent.type === "content_plan") {
      const plan = await aiService.generateWeeklyContentPlan({ language: user.language });
      await ctx.reply(plan);
      return;
    }
    if (intent.type === "create_text_poster") {
      await createTextPosterDraft({
        ctx,
        userId,
        prompt: text
      });
      return;
    }

    const answer = await aiService.chatAssistant({
      language: user.language,
      prompt: text,
      context:
        user.language === "ru"
          ? "Отвечай как AI контент-ассистент клиники: безопасный маркетинг, идеи, стиль, без диагноза."
          : "Reply as clinic content AI assistant: safe marketing, content strategy, no diagnosis."
    });
    await ctx.reply(answer);
  };

  const handleDraftInstruction = async (
    ctx: Context,
    userId: number,
    contentId: number,
    instruction: string
  ): Promise<void> => {
    const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
    const media = db.getMediaItemById(draft.media_item_id);
    if (!media) {
      throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
    }

    const intent = assistantCommandService.classify(instruction);
    if (assistantCommandService.isMedicalAdviceQuestion(instruction)) {
      await ctx.reply(assistantCommandService.buildMedicalSafetyReply(draft.language));
      return;
    }

    if (intent.type === "approve_intent") {
      await ctx.reply("Подтвердите публикацию кнопкой Approve.");
      return;
    }
    if (intent.type === "cancel") {
      db.updateGeneratedStatus(draft.id, "failed");
      const session = draftSessions.get(userId);
      if (session) {
        session.activeDraftContentId = undefined;
        draftSessions.set(userId, session);
      }
      await ctx.reply("Draft отменён.");
      return;
    }
    if (intent.type === "use_original") {
      db.setUseOriginalMedia(draft.id, true);
      await ctx.reply(
        [
          "Будет опубликовано исходное фото без дизайна.",
          "",
          "Текст, который будет опубликован в Instagram:",
          draft.final_instagram_caption ?? draft.selected_caption ?? ""
        ].join("\n"),
        buildActionKeyboard(draft.id)
      );
      return;
    }
    if (intent.type === "change_language" && intent.languageHint) {
      db.updateGeneratedLanguage(draft.id, intent.languageHint);
      await ctx.reply(`Язык draft обновлён на ${intent.languageHint.toUpperCase()}. Нажмите Regenerate text.`);
      return;
    }
    if (intent.type === "create_text_poster") {
      await createTextPosterDraft({
        ctx,
        userId,
        prompt: instruction
      });
      return;
    }
    if (intent.type === "edit_design") {
      const preferredStyle = isGeneratedPosterMedia(media)
        ? choosePosterStyleFromText(instruction)
        : chooseStyleFromText(instruction);
      await sendDraftPreview({
        ctx,
        userId,
        contentId: draft.id,
        media,
        payload: getDraftPayload(draft),
        preferredStyle
      });
      return;
    }
    if (intent.type === "edit_caption") {
      const currentCaption = draft.final_instagram_caption ?? draft.selected_caption ?? "";
      let updatedCaption = currentCaption;
      let hashtags = parseJsonStringArray(draft.hashtags_json);
      const lower = instruction.toLowerCase();
      if (/убери хэшт|remove hashtags/.test(lower)) {
        updatedCaption = removeHashtagsFromCaption(updatedCaption);
        hashtags = [];
      }
      if (/короче|shorter|проще/.test(lower)) {
        updatedCaption = shortenCaptionText(updatedCaption);
      }
      if (/профессиональ|more professional/.test(lower)) {
        updatedCaption = makeCaptionMoreProfessional(updatedCaption);
      }
      db.updateFinalCaptionAndHashtags({
        contentId: draft.id,
        finalCaption: updatedCaption,
        hashtags,
        selectedCaption: draft.selected_caption ?? undefined
      });
      await ctx.reply(
        ["Текст, который будет опубликован в Instagram:", updatedCaption].join("\n"),
        buildActionKeyboard(draft.id)
      );
      return;
    }

    if (intent.type === "generate_ideas") {
      await ctx.reply(await aiService.generateIdeas({ language: draft.language, count: 5 }));
      return;
    }
    if (intent.type === "content_plan") {
      await ctx.reply(await aiService.generateWeeklyContentPlan({ language: draft.language }));
      return;
    }

    await ctx.reply("Инструкцию не удалось распознать. Попробуйте: «сделай дизайн премиальнее» или «сделай текст короче».");
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
        "Привет! Я AI content assistant для Instagram клиники.",
        "Можно отправить фото/видео для нового поста или написать обычный вопрос по контенту.",
        "Команды: /newpost /ideas /contentplan /draft /cancel"
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
        "/newpost",
        "/ideas",
        "/contentplan",
        "/settings",
        "/draft",
        "/cancel"
      ].join("\n")
    );
  });

  bot.command("newpost", async (ctx) => {
    await ctx.reply("Отправьте фото/видео и затем описание. Я подготовлю дизайн и финальный caption для утверждения.");
  });

  bot.command("ideas", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const user = db.getUserByTelegramId(userId);
    await ctx.reply(await aiService.generateIdeas({ language: user.language, count: 10 }));
  });

  bot.command("contentplan", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const user = db.getUserByTelegramId(userId);
    await ctx.reply(await aiService.generateWeeklyContentPlan({ language: user.language }));
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
      [
        `language: ${user.language}`,
        "default content type: post",
        "media processing enabled: yes",
        "brand name: MC Clinic Medical"
      ].join("\n")
    );
  });

  bot.command("draft", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const session = draftSessions.get(userId);
    const activeId = session?.activeDraftContentId;
    if (!activeId) {
      await ctx.reply("Активного draft нет. Отправьте фото/видео или используйте /newpost.");
      return;
    }
    const draft = db.getGeneratedContentByIdForTelegramUser(activeId, userId);
    await ctx.reply(
      [`Активный draft #${draft.id}`, "", "Текст, который будет опубликован в Instagram:", draft.final_instagram_caption ?? ""].join("\n"),
      buildActionKeyboard(draft.id)
    );
  });

  bot.command("cancel", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const session = draftSessions.get(userId);
    if (session?.activeDraftContentId) {
      db.updateGeneratedStatus(session.activeDraftContentId, "failed");
    }
    draftSessions.delete(userId);
    await ctx.reply("Текущий draft отменён.");
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
      await ctx.reply("Фото получено. Теперь отправьте описание, и я подготовлю контент.");
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
      await ctx.reply("Видео получено. Теперь отправьте описание для контента.");
    } catch (error) {
      const appError = toAppError(error, "Video processing failed");
      await ctx.reply(`Ошибка обработки видео: ${appError.message}`);
    }
  });

  bot.on("text", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    try {
      const session = draftSessions.get(userId);
      if (session?.awaitingScheduleForContentId) {
        const parsed = dayjs(text);
        if (!parsed.isValid()) {
          await ctx.reply("Неверный формат даты. Пример: 2026-05-24 14:30");
          return;
        }
        const contentId = session.awaitingScheduleForContentId;
        db.getGeneratedContentByIdForTelegramUser(contentId, userId);
        workflowService.approveDraft(contentId);
        workflowService.scheduleDraft(contentId, parsed.toISOString());
        session.awaitingScheduleForContentId = undefined;
        draftSessions.set(userId, session);
        await ctx.reply("Публикация запланирована.");
        return;
      }

      if (session?.activeDraftContentId) {
        await handleDraftInstruction(ctx, userId, session.activeDraftContentId, text);
        return;
      }

      if (!session) {
        await handleAssistantChat(ctx, userId, text);
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
        `Внимание: ${inputSafety.warningMessage}\nНайдены триггеры: ${inputSafety.blockedTerms.join(", ")}`
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
        safeRewriteHint: generated.safeRewriteHint,
        visualTitle: generated.visualTitle,
        visualSubtitle: generated.visualSubtitle,
        designHint: generated.designHint
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
        userId,
        contentId,
        media,
        payload: {
          contentType: session.contentType,
          language,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          visualTitle: generated.visualTitle,
          visualSubtitle: generated.visualSubtitle,
          designHint: generated.designHint,
          bulletPoints: generated.bulletPoints,
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
      if (result.success) {
        const session = draftSessions.get(userId);
        if (session?.activeDraftContentId === contentId) {
          session.activeDraftContentId = undefined;
          draftSessions.set(userId, session);
        }
      }
      await ctx.reply(result.success ? "Published successfully" : `Ошибка публикации: ${result.message}`);
    } catch (error) {
      const appError = toAppError(error, "Approve/publish failed");
      await ctx.reply(`Ошибка approve: ${appError.message}`);
    }
  });

  bot.action(/^regenerate_text:(\d+)$/, async (ctx) => {
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
        visualTitle: generated.visualTitle,
        visualSubtitle: generated.visualSubtitle,
        designHint: generated.designHint,
        reelIdea: generated.reelIdea,
        riskWarning: generated.riskWarning,
        safeRewriteHint: generated.safeRewriteHint
      });
      await ctx.answerCbQuery();
      await sendDraftPreview({
        ctx,
        userId,
        contentId: newContentId,
        media,
        payload: {
          contentType: draft.content_type,
          language: draft.language,
          captions: generated.captions,
          hashtags: generated.hashtags,
          cta: generated.cta,
          storyText: generated.storyText,
          visualTitle: generated.visualTitle,
          visualSubtitle: generated.visualSubtitle,
          designHint: generated.designHint,
          bulletPoints: generated.bulletPoints,
          reelIdea: generated.reelIdea,
          riskWarning: generated.riskWarning,
          safeRewriteHint: generated.safeRewriteHint
        }
      });
    } catch (error) {
      const appError = toAppError(error, "Regenerate text failed");
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
        userId,
        contentId: draft.id,
        media,
        payload: getDraftPayload(draft)
      });
    } catch (error) {
      const appError = toAppError(error, "Regenerate design failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка regenerate design: ${appError.message}`);
    }
  });

  bot.action(/^change_style:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const media = db.getMediaItemById(draft.media_item_id);
      if (!media) {
        throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
      }
      await ctx.answerCbQuery();
      await ctx.reply(
        "Выберите стиль:",
        isGeneratedPosterMedia(media) ? buildPosterStyleKeyboard(contentId) : buildStyleKeyboard(contentId)
      );
    } catch (error) {
      const appError = toAppError(error, "Style chooser failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка стиля: ${appError.message}`);
    }
  });

  bot.action(/^stylepick:(\d+):(clean_light|premium_card|equipment_focus|announcement|educational|minimal_storylike|split_layout|full_bleed_blur)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    const variant = ctx.match[2] as MediaDesignVariant;
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const media = db.getMediaItemById(draft.media_item_id);
      if (!media) {
        throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
      }
      await ctx.answerCbQuery(`Style: ${STYLE_LABELS[variant]}`);
      await sendDraftPreview({
        ctx,
        userId,
        contentId: draft.id,
        media,
        payload: getDraftPayload(draft),
        preferredStyle: variant
      });
    } catch (error) {
      const appError = toAppError(error, "Style apply failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка применения стиля: ${appError.message}`);
    }
  });

  bot.action(
    /^posterstyle:(\d+):(morning_health|medical_tip|clinic_announcement|minimalist_quote|service_card|educational_card)$/,
    async (ctx) => {
      const userId = getUserId(ctx);
      if (!userId) return;
      const contentId = parseActionContentId(ctx.match[1]);
      const variant = ctx.match[2] as TextPosterStyleVariant;
      try {
        const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
        const media = db.getMediaItemById(draft.media_item_id);
        if (!media) {
          throw new AppError("Media not found", { code: "NOT_FOUND", statusCode: 404 });
        }
        await ctx.answerCbQuery(`Style: ${POSTER_STYLE_LABELS[variant]}`);
        await sendDraftPreview({
          ctx,
          userId,
          contentId: draft.id,
          media,
          payload: getDraftPayload(draft),
          preferredStyle: variant
        });
      } catch (error) {
        const appError = toAppError(error, "Poster style apply failed");
        await ctx.answerCbQuery();
        await ctx.reply(`Ошибка применения стиля: ${appError.message}`);
      }
    }
  );

  bot.action(/^caption_shorter:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const shortened = shortenCaptionText(draft.final_instagram_caption ?? draft.selected_caption ?? "");
      db.updateFinalCaptionAndHashtags({
        contentId: draft.id,
        finalCaption: shortened,
        hashtags: parseJsonStringArray(draft.hashtags_json)
      });
      await ctx.answerCbQuery();
      await ctx.reply(["Текст, который будет опубликован в Instagram:", shortened].join("\n"), buildActionKeyboard(draft.id));
    } catch (error) {
      const appError = toAppError(error, "Caption shorten failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка caption: ${appError.message}`);
    }
  });

  bot.action(/^caption_professional:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const updated = makeCaptionMoreProfessional(draft.final_instagram_caption ?? draft.selected_caption ?? "");
      db.updateFinalCaptionAndHashtags({
        contentId: draft.id,
        finalCaption: updated,
        hashtags: parseJsonStringArray(draft.hashtags_json)
      });
      await ctx.answerCbQuery();
      await ctx.reply(["Текст, который будет опубликован в Instagram:", updated].join("\n"), buildActionKeyboard(draft.id));
    } catch (error) {
      const appError = toAppError(error, "Caption style failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка caption: ${appError.message}`);
    }
  });

  bot.action(/^caption_nohashtags:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const contentId = parseActionContentId(ctx.match[1]);
    try {
      const draft = db.getGeneratedContentByIdForTelegramUser(contentId, userId);
      const updated = removeHashtagsFromCaption(draft.final_instagram_caption ?? draft.selected_caption ?? "");
      db.updateFinalCaptionAndHashtags({
        contentId: draft.id,
        finalCaption: updated,
        hashtags: []
      });
      await ctx.answerCbQuery();
      await ctx.reply(["Текст, который будет опубликован в Instagram:", updated].join("\n"), buildActionKeyboard(draft.id));
    } catch (error) {
      const appError = toAppError(error, "Caption hashtag update failed");
      await ctx.answerCbQuery();
      await ctx.reply(`Ошибка caption: ${appError.message}`);
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
      await ctx.reply(
        [
          "Будет опубликовано исходное фото без дизайна.",
          "",
          "Текст, который будет опубликован в Instagram:",
          draft.final_instagram_caption ?? draft.selected_caption ?? ""
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
      const session = draftSessions.get(userId);
      if (session?.activeDraftContentId === contentId) {
        session.activeDraftContentId = undefined;
        draftSessions.set(userId, session);
      }
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

