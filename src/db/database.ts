import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { env } from "../config/env.js";
import { ContentType, DraftStatus, Language, MediaType } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { ensureDir } from "../utils/fs.js";

export interface DbGeneratedContent {
  id: number;
  user_id: number;
  media_item_id: number;
  content_type: ContentType;
  language: Language;
  description: string;
  captions_json: string;
  hashtags_json: string;
  cta: string;
  story_text: string;
  reel_idea: string | null;
  risk_warning: string | null;
  safe_rewrite_hint: string | null;
  visual_title: string | null;
  visual_subtitle: string | null;
  design_hint: string | null;
  design_variant: string | null;
  design_seed: string | null;
  design_attempt_number: number;
  selected_caption: string | null;
  use_original_media: number;
  final_instagram_caption: string | null;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
}

export interface DbMediaItem {
  id: number;
  user_id: number;
  telegram_file_id: string;
  media_type: MediaType;
  local_path: string;
  storage_url: string | null;
  storage_url_original: string | null;
  storage_url_processed: string | null;
  processed_media_path: string | null;
  media_processing_status: string;
  media_design_version: string | null;
  created_at: string;
}

export class AppDatabase {
  private db: Database.Database;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  static async init(dbPath: string): Promise<AppDatabase> {
    const fullPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    await ensureDir(path.dirname(fullPath));
    const instance = new AppDatabase(fullPath);
    const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    instance.db.exec(schema);
    instance.ensureMigrations();
    return instance;
  }

  private ensureMigrations(): void {
    const mediaColumns = this.db.prepare("PRAGMA table_info(media_items)").all() as Array<{
      name: string;
    }>;
    const generatedColumns = this.db.prepare("PRAGMA table_info(generated_contents)").all() as Array<{
      name: string;
    }>;

    const mediaColumnMigrations: Array<{ name: string; sql: string }> = [
      { name: "storage_url", sql: "ALTER TABLE media_items ADD COLUMN storage_url TEXT" },
      { name: "storage_url_original", sql: "ALTER TABLE media_items ADD COLUMN storage_url_original TEXT" },
      { name: "storage_url_processed", sql: "ALTER TABLE media_items ADD COLUMN storage_url_processed TEXT" },
      { name: "processed_media_path", sql: "ALTER TABLE media_items ADD COLUMN processed_media_path TEXT" },
      {
        name: "media_processing_status",
        sql: "ALTER TABLE media_items ADD COLUMN media_processing_status TEXT NOT NULL DEFAULT 'pending'"
      },
      { name: "media_design_version", sql: "ALTER TABLE media_items ADD COLUMN media_design_version TEXT" }
    ];

    for (const migration of mediaColumnMigrations) {
      const exists = mediaColumns.some((column) => column.name === migration.name);
      if (!exists) {
        this.db.exec(migration.sql);
      }
    }

    const generatedColumnMigrations: Array<{ name: string; sql: string }> = [
      {
        name: "use_original_media",
        sql: "ALTER TABLE generated_contents ADD COLUMN use_original_media INTEGER NOT NULL DEFAULT 0"
      },
      {
        name: "final_instagram_caption",
        sql: "ALTER TABLE generated_contents ADD COLUMN final_instagram_caption TEXT"
      },
      {
        name: "visual_title",
        sql: "ALTER TABLE generated_contents ADD COLUMN visual_title TEXT"
      },
      {
        name: "visual_subtitle",
        sql: "ALTER TABLE generated_contents ADD COLUMN visual_subtitle TEXT"
      },
      {
        name: "design_hint",
        sql: "ALTER TABLE generated_contents ADD COLUMN design_hint TEXT"
      },
      {
        name: "design_variant",
        sql: "ALTER TABLE generated_contents ADD COLUMN design_variant TEXT"
      },
      {
        name: "design_seed",
        sql: "ALTER TABLE generated_contents ADD COLUMN design_seed TEXT"
      },
      {
        name: "design_attempt_number",
        sql: "ALTER TABLE generated_contents ADD COLUMN design_attempt_number INTEGER NOT NULL DEFAULT 0"
      }
    ];

    for (const migration of generatedColumnMigrations) {
      const exists = generatedColumns.some((column) => column.name === migration.name);
      if (!exists) {
        this.db.exec(migration.sql);
      }
    }
  }

  getOrCreateUser(telegramUserId: number): { id: number; tone: string; language: Language } {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO users (telegram_user_id, tone, language, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      )
      .run(telegramUserId, env.DEFAULT_TONE, env.DEFAULT_LANGUAGE);

    return this.db
      .prepare("SELECT id, tone, language FROM users WHERE telegram_user_id = ?")
      .get(telegramUserId) as { id: number; tone: string; language: Language };
  }

  updateUserSetting(telegramUserId: number, key: "tone" | "language", value: string): void {
    const user = this.getOrCreateUser(telegramUserId);
    this.db
      .prepare(`UPDATE users SET ${key} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(value, user.id);

    this.db
      .prepare(
        "INSERT INTO settings (user_id, key, value, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
      )
      .run(user.id, key, value);
  }

  setInstagramAccountId(telegramUserId: number, instagramAccountId: string): void {
    const user = this.getOrCreateUser(telegramUserId);
    this.db
      .prepare("UPDATE users SET instagram_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(instagramAccountId, user.id);
  }

  getUserByTelegramId(
    telegramUserId: number
  ): { id: number; tone: string; language: Language; instagram_account_id: string | null } {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare("SELECT id, tone, language, instagram_account_id FROM users WHERE id = ?")
      .get(user.id) as {
      id: number;
      tone: string;
      language: Language;
      instagram_account_id: string | null;
    };
  }

  createMediaItem(input: {
    telegramUserId: number;
    telegramFileId: string;
    mediaType: MediaType;
    localPath: string;
    storageUrlOriginal?: string;
  }): number {
    const user = this.getOrCreateUser(input.telegramUserId);
    const result = this.db
      .prepare(
        `INSERT INTO media_items (
          user_id, telegram_file_id, media_type, local_path, storage_url, storage_url_original,
          media_processing_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
      )
      .run(
        user.id,
        input.telegramFileId,
        input.mediaType,
        input.localPath,
        input.storageUrlOriginal ?? null,
        input.storageUrlOriginal ?? null
      );
    return Number(result.lastInsertRowid);
  }

  getMediaItemById(id: number): DbMediaItem | undefined {
    return this.db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as DbMediaItem | undefined;
  }

  getLatestMediaItemWithStorageUrl(mediaType: MediaType = "image"): DbMediaItem | undefined {
    return this.db
      .prepare(
        `SELECT * FROM media_items
         WHERE media_type = ?
           AND COALESCE(storage_url_processed, storage_url_original, storage_url) IS NOT NULL
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 1`
      )
      .get(mediaType) as DbMediaItem | undefined;
  }

  createGeneratedContent(input: {
    telegramUserId: number;
    mediaItemId: number;
    contentType: ContentType;
    language: Language;
    description: string;
    captions: string[];
    hashtags: string[];
    cta: string;
    storyText: string;
    reelIdea?: string;
    riskWarning?: string;
    safeRewriteHint?: string;
    visualTitle?: string;
    visualSubtitle?: string;
    designHint?: string;
  }): number {
    const user = this.getOrCreateUser(input.telegramUserId);
    const result = this.db
      .prepare(
        `INSERT INTO generated_contents (
          user_id, media_item_id, content_type, language, description, captions_json, hashtags_json,
          cta, story_text, reel_idea, risk_warning, safe_rewrite_hint, visual_title, visual_subtitle,
          design_hint, use_original_media,
          final_instagram_caption, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(
        user.id,
        input.mediaItemId,
        input.contentType,
        input.language,
        input.description,
        JSON.stringify(input.captions),
        JSON.stringify(input.hashtags),
        input.cta,
        input.storyText,
        input.reelIdea ?? null,
        input.riskWarning ?? null,
        input.safeRewriteHint ?? null,
        input.visualTitle ?? null,
        input.visualSubtitle ?? null,
        input.designHint ?? null
      );

    return Number(result.lastInsertRowid);
  }

  getGeneratedContentById(id: number): DbGeneratedContent | undefined {
    return this.db
      .prepare("SELECT * FROM generated_contents WHERE id = ?")
      .get(id) as DbGeneratedContent | undefined;
  }

  getGeneratedContentByIdForTelegramUser(contentId: number, telegramUserId: number): DbGeneratedContent {
    const user = this.getOrCreateUser(telegramUserId);
    const row = this.db
      .prepare("SELECT * FROM generated_contents WHERE id = ? AND user_id = ?")
      .get(contentId, user.id) as DbGeneratedContent | undefined;
    if (!row) {
      throw new AppError("Draft not found for current user", {
        code: "NOT_FOUND",
        statusCode: 404
      });
    }
    return row;
  }

  selectCaption(contentId: number, caption: string): void {
    this.db
      .prepare("UPDATE generated_contents SET selected_caption = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(caption, contentId);
  }

  setFinalInstagramCaption(contentId: number, caption: string): void {
    this.db
      .prepare(
        "UPDATE generated_contents SET final_instagram_caption = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .run(caption, contentId);
  }

  setUseOriginalMedia(contentId: number, useOriginal: boolean): void {
    this.db
      .prepare("UPDATE generated_contents SET use_original_media = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(useOriginal ? 1 : 0, contentId);
  }

  updateDesignMetadata(input: {
    contentId: number;
    designVariant: string;
    designSeed: string;
    incrementAttempt?: boolean;
  }): void {
    const attemptExpression = input.incrementAttempt
      ? "design_attempt_number = COALESCE(design_attempt_number, 0) + 1,"
      : "";
    this.db
      .prepare(
        `UPDATE generated_contents
         SET design_variant = ?,
             design_seed = ?,
             ${attemptExpression}
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(input.designVariant, input.designSeed, input.contentId);
  }

  updateGeneratedLanguage(contentId: number, language: Language): void {
    this.db
      .prepare("UPDATE generated_contents SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(language, contentId);
  }

  updateFinalCaptionAndHashtags(input: {
    contentId: number;
    finalCaption: string;
    hashtags: string[];
    selectedCaption?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE generated_contents
         SET final_instagram_caption = ?,
             hashtags_json = ?,
             selected_caption = COALESCE(?, selected_caption),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(input.finalCaption, JSON.stringify(input.hashtags), input.selectedCaption ?? null, input.contentId);
  }

  updateMediaDesignResult(input: {
    mediaItemId: number;
    storageUrlProcessed?: string;
    processedMediaPath?: string;
    mediaProcessingStatus: "pending" | "processed" | "failed" | "skipped";
    mediaDesignVersion?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE media_items
         SET storage_url_processed = ?,
             processed_media_path = ?,
             media_processing_status = ?,
             media_design_version = ?
         WHERE id = ?`
      )
      .run(
        input.storageUrlProcessed ?? null,
        input.processedMediaPath ?? null,
        input.mediaProcessingStatus,
        input.mediaDesignVersion ?? null,
        input.mediaItemId
      );
  }

  updateGeneratedStatus(contentId: number, status: DraftStatus): void {
    this.db
      .prepare("UPDATE generated_contents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, contentId);
  }

  createSchedule(contentId: number, scheduledAtIso: string): number {
    const result = this.db
      .prepare(
        "INSERT INTO scheduled_posts (generated_content_id, scheduled_at, job_status, created_at, updated_at) VALUES (?, ?, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      )
      .run(contentId, scheduledAtIso);
    this.updateGeneratedStatus(contentId, "scheduled");
    return Number(result.lastInsertRowid);
  }

  listDueSchedules(nowIso: string): Array<{ scheduleId: number; generatedContentId: number }> {
    return this.db
      .prepare(
        `SELECT sp.id AS scheduleId, sp.generated_content_id AS generatedContentId
         FROM scheduled_posts sp
         JOIN generated_contents gc ON gc.id = sp.generated_content_id
         WHERE sp.job_status = 'scheduled'
           AND gc.status IN ('approved', 'scheduled')
           AND datetime(sp.scheduled_at) <= datetime(?)`
      )
      .all(nowIso) as Array<{ scheduleId: number; generatedContentId: number }>;
  }

  updateScheduleStatus(
    scheduleId: number,
    status: "scheduled" | "running" | "published" | "failed" | "cancelled"
  ): void {
    this.db
      .prepare("UPDATE scheduled_posts SET job_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, scheduleId);
  }

  createPublishLog(input: {
    generatedContentId: number;
    status: "published" | "failed";
    igMediaId?: string;
    igContainerId?: string;
    errorMessage?: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO publish_logs (generated_content_id, status, ig_media_id, ig_container_id, error_message, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
      )
      .run(
        input.generatedContentId,
        input.status,
        input.igMediaId ?? null,
        input.igContainerId ?? null,
        input.errorMessage ?? null
      );
  }

  markPublished(contentId: number): void {
    this.db
      .prepare("UPDATE generated_contents SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(contentId);
  }

  markFailed(contentId: number): void {
    this.db
      .prepare("UPDATE generated_contents SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(contentId);
  }

  listDrafts(
    telegramUserId: number
  ): Array<{ id: number; status: DraftStatus; content_type: ContentType; created_at: string }> {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare(
        "SELECT id, status, content_type, created_at FROM generated_contents WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 10"
      )
      .all(user.id) as Array<{
      id: number;
      status: DraftStatus;
      content_type: ContentType;
      created_at: string;
    }>;
  }

  listScheduled(
    telegramUserId: number
  ): Array<{ id: number; scheduled_at: string; job_status: string; generated_content_id: number }> {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare(
        `SELECT sp.id, sp.scheduled_at, sp.job_status, sp.generated_content_id
         FROM scheduled_posts sp
         JOIN generated_contents gc ON gc.id = sp.generated_content_id
         WHERE gc.user_id = ?
         ORDER BY datetime(sp.scheduled_at) ASC
         LIMIT 10`
      )
      .all(user.id) as Array<{
      id: number;
      scheduled_at: string;
      job_status: string;
      generated_content_id: number;
    }>;
  }
}
