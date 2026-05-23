import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { Language, ContentType, DraftStatus, MediaType } from "../types/domain.js";
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
  selected_caption: string | null;
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
  created_at: string;
}

export class AppDatabase {
  private db: Database.Database;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  static async init(dbPath: string): Promise<AppDatabase> {
    const fullPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    await ensureDir(path.dirname(fullPath));
    const instance = new AppDatabase(fullPath);
    const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    instance.db.exec(schema);
    return instance;
  }

  getOrCreateUser(telegramUserId: number): { id: number; tone: string; language: Language } {
    const existing = this.db
      .prepare("SELECT id, tone, language FROM users WHERE telegram_user_id = ?")
      .get(telegramUserId) as { id: number; tone: string; language: Language } | undefined;

    if (existing) {
      return existing;
    }

    this.db
      .prepare(
        "INSERT INTO users (telegram_user_id, tone, language, created_at, updated_at) VALUES (?, 'professional', 'ru', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      )
      .run(telegramUserId);

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
  }): number {
    const user = this.getOrCreateUser(input.telegramUserId);
    const result = this.db
      .prepare(
        "INSERT INTO media_items (user_id, telegram_file_id, media_type, local_path, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
      )
      .run(user.id, input.telegramFileId, input.mediaType, input.localPath);

    return Number(result.lastInsertRowid);
  }

  getMediaItemById(id: number): DbMediaItem | undefined {
    return this.db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as DbMediaItem | undefined;
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
  }): number {
    const user = this.getOrCreateUser(input.telegramUserId);
    const result = this.db
      .prepare(
        `INSERT INTO generated_contents (
          user_id, media_item_id, content_type, language, description, captions_json, hashtags_json,
          cta, story_text, reel_idea, risk_warning, safe_rewrite_hint, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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
        input.safeRewriteHint ?? null
      );

    return Number(result.lastInsertRowid);
  }

  getGeneratedContentById(id: number): DbGeneratedContent | undefined {
    return this.db
      .prepare("SELECT * FROM generated_contents WHERE id = ?")
      .get(id) as DbGeneratedContent | undefined;
  }

  getLatestDraftByTelegramUserId(telegramUserId: number): DbGeneratedContent | undefined {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare(
        "SELECT * FROM generated_contents WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1"
      )
      .get(user.id) as DbGeneratedContent | undefined;
  }

  selectCaption(contentId: number, caption: string): void {
    this.db
      .prepare("UPDATE generated_contents SET selected_caption = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(caption, contentId);
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
    const rows = this.db
      .prepare(
        `SELECT sp.id AS scheduleId, sp.generated_content_id AS generatedContentId
         FROM scheduled_posts sp
         WHERE sp.job_status = 'scheduled' AND datetime(sp.scheduled_at) <= datetime(?)`
      )
      .all(nowIso) as Array<{ scheduleId: number; generatedContentId: number }>;
    return rows;
  }

  updateScheduleStatus(scheduleId: number, status: "scheduled" | "running" | "published" | "failed" | "cancelled"): void {
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

  listDrafts(telegramUserId: number): Array<{ id: number; status: DraftStatus; content_type: ContentType; created_at: string }> {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare(
        "SELECT id, status, content_type, created_at FROM generated_contents WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 10"
      )
      .all(user.id) as Array<{ id: number; status: DraftStatus; content_type: ContentType; created_at: string }>;
  }

  listScheduled(telegramUserId: number): Array<{ id: number; scheduled_at: string; job_status: string }> {
    const user = this.getOrCreateUser(telegramUserId);
    return this.db
      .prepare(
        `SELECT sp.id, sp.scheduled_at, sp.job_status
         FROM scheduled_posts sp
         JOIN generated_contents gc ON gc.id = sp.generated_content_id
         WHERE gc.user_id = ?
         ORDER BY datetime(sp.scheduled_at) ASC
         LIMIT 10`
      )
      .all(user.id) as Array<{ id: number; scheduled_at: string; job_status: string }>;
  }
}
