import Database from "better-sqlite3";
import path from "node:path";

import { env } from "../config/env.js";
import { AppDatabase } from "../db/database.js";

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row?.name);
}

function printTableInfo(db: Database.Database, tableName: string): void {
  if (!tableExists(db, tableName)) {
    return;
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  console.log("table schema", {
    table: tableName,
    columnCount: columns.length,
    columns: columns.map((column) => column.name)
  });
}

async function main(): Promise<void> {
  await AppDatabase.init(env.DATABASE_URL);
  const dbPath = path.isAbsolute(env.DATABASE_URL)
    ? env.DATABASE_URL
    : path.resolve(process.cwd(), env.DATABASE_URL);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const testUserId = 990000001;
  const fileMarker = `test-db-file-${Date.now()}`;
  const descriptionMarker = `test-db-description-${Date.now()}`;
  const designSeed = `seed-${Date.now()}`;
  let mediaItemId = 0;
  let contentId = 0;

  try {
    printTableInfo(db, "media_items");
    printTableInfo(db, "generated_contents");
    printTableInfo(db, "scheduled_posts");
    printTableInfo(db, "drafts");

    db.prepare(
      "INSERT OR IGNORE INTO users (telegram_user_id, tone, language, created_at, updated_at) VALUES (?, 'professional', 'ru', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ).run(testUserId);
    const userRow = db
      .prepare("SELECT id FROM users WHERE telegram_user_id = ?")
      .get(testUserId) as { id: number } | undefined;
    if (!userRow) {
      throw new Error("Failed to create/get test user");
    }

    const mediaInsert = db
      .prepare(
        `INSERT INTO media_items (
          user_id, telegram_file_id, media_type, local_path, storage_url, storage_url_original,
          storage_url_processed, processed_media_path, media_processing_status, media_design_version, created_at
        ) VALUES (?, ?, 'image', ?, ?, ?, NULL, NULL, 'pending', NULL, CURRENT_TIMESTAMP)`
      )
      .run(
        userRow.id,
        fileMarker,
        "/workspace/media/test-db.jpg",
        "https://example.com/original.jpg",
        "https://example.com/original.jpg"
      );
    mediaItemId = Number(mediaInsert.lastInsertRowid);

    const contentInsert = db
      .prepare(
        `INSERT INTO generated_contents (
          user_id, media_item_id, content_type, language, description, captions_json, hashtags_json,
          cta, story_text, reel_idea, risk_warning, safe_rewrite_hint, visual_title, visual_subtitle,
          design_hint, design_variant, design_seed, design_attempt_number, selected_caption,
          use_original_media, final_instagram_caption, status, created_at, updated_at
        ) VALUES (?, ?, 'post', 'ru', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?, 1, ?, 0, ?, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(
        userRow.id,
        mediaItemId,
        descriptionMarker,
        JSON.stringify(["Тестовый caption"]),
        JSON.stringify(["#test", "#clinic"]),
        "Запишитесь на консультацию.",
        "Story text",
        "Современное пространство для ухода",
        "clean_light",
        "clean_light",
        designSeed,
        "Тестовый caption",
        "Тестовый caption\n\nЗапишитесь на консультацию.\n\n#test #clinic"
      );
    contentId = Number(contentInsert.lastInsertRowid);

    db.prepare(
      "UPDATE media_items SET storage_url_processed = ?, processed_media_path = ?, media_processing_status = ?, media_design_version = ? WHERE id = ?"
    ).run(
      "https://example.com/processed.jpg",
      "/workspace/tmp/test-processed.jpg",
      "processed",
      "photo-v4/clean_light",
      mediaItemId
    );
    db.prepare(
      "UPDATE generated_contents SET final_instagram_caption = ?, design_variant = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run("Обновлённый caption\n\n#test #clinic", "premium_card", contentId);

    const mediaRow = db
      .prepare(
        "SELECT id, storage_url_processed, media_processing_status, media_design_version FROM media_items WHERE id = ?"
      )
      .get(mediaItemId) as
      | { id: number; storage_url_processed: string | null; media_processing_status: string; media_design_version: string | null }
      | undefined;
    const contentRow = db
      .prepare(
        "SELECT id, final_instagram_caption, design_variant, design_seed, design_attempt_number FROM generated_contents WHERE id = ?"
      )
      .get(contentId) as
      | {
          id: number;
          final_instagram_caption: string | null;
          design_variant: string | null;
          design_seed: string | null;
          design_attempt_number: number;
        }
      | undefined;

    if (!mediaRow || !contentRow) {
      throw new Error("Failed to read back test rows");
    }

    console.log("test:db row check", {
      mediaItemId: mediaRow.id,
      mediaProcessingStatus: mediaRow.media_processing_status,
      contentId: contentRow.id,
      designVariant: contentRow.design_variant,
      designAttemptNumber: contentRow.design_attempt_number
    });
    console.log("test:db passed");
  } finally {
    if (contentId) {
      db.prepare("DELETE FROM generated_contents WHERE id = ?").run(contentId);
    }
    if (mediaItemId) {
      db.prepare("DELETE FROM media_items WHERE id = ?").run(mediaItemId);
    }
    db.prepare("DELETE FROM users WHERE telegram_user_id = ?").run(testUserId);
    db.close();
  }
}

main().catch((error) => {
  console.error(`test:db failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

