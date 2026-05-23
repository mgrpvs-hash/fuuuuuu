CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  instagram_account_id TEXT,
  tone TEXT NOT NULL DEFAULT 'professional',
  language TEXT NOT NULL DEFAULT 'ru',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
  local_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  media_item_id INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('post', 'reel', 'story')),
  language TEXT NOT NULL CHECK(language IN ('ru', 'en')),
  description TEXT NOT NULL,
  captions_json TEXT NOT NULL,
  hashtags_json TEXT NOT NULL,
  cta TEXT NOT NULL,
  story_text TEXT NOT NULL,
  reel_idea TEXT,
  risk_warning TEXT,
  safe_rewrite_hint TEXT,
  selected_caption TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'scheduled', 'published', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (media_item_id) REFERENCES media_items(id)
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_content_id INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  job_status TEXT NOT NULL DEFAULT 'scheduled' CHECK(job_status IN ('scheduled', 'running', 'published', 'failed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generated_content_id) REFERENCES generated_contents(id)
);

CREATE TABLE IF NOT EXISTS publish_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_content_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published', 'failed')),
  ig_media_id TEXT,
  ig_container_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generated_content_id) REFERENCES generated_contents(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_generated_contents_user_created
  ON generated_contents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_contents_status
  ON generated_contents(status);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_scheduled_at
  ON scheduled_posts(job_status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_publish_logs_generated_content
  ON publish_logs(generated_content_id, created_at DESC);
