import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { MediaType } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { logger } from "../utils/logger.js";

export interface UploadedMediaResult {
  storagePath: string;
  publicUrl: string;
}

function resolveContentType(localPath: string, mediaType: MediaType): string {
  const ext = path.extname(localPath).toLowerCase();
  if (mediaType === "image") {
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    return "image/jpeg";
  }
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  return "video/mp4";
}

export class StorageService {
  private readonly storageLogger = logger.child({ component: "storage-service" });
  private readonly supabase =
    env.MEDIA_STORAGE_PROVIDER === "supabase"
      ? createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null;

  async uploadMediaFromLocal(input: {
    localPath: string;
    mediaType: MediaType;
  }): Promise<UploadedMediaResult> {
    if (env.MEDIA_STORAGE_PROVIDER === "supabase") {
      return this.uploadToSupabase(input);
    }
    return this.resolveLocalPublicUrl(input.localPath);
  }

  private async uploadToSupabase(input: {
    localPath: string;
    mediaType: MediaType;
  }): Promise<UploadedMediaResult> {
    if (!this.supabase || !env.SUPABASE_STORAGE_BUCKET) {
      throw new AppError("Supabase storage client is not configured", {
        code: "VALIDATION_ERROR",
        statusCode: 500
      });
    }

    const fileBuffer = await fs.readFile(input.localPath);
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = path.extname(input.localPath).toLowerCase() || (input.mediaType === "image" ? ".jpg" : ".mp4");
    const filename = `${Date.now()}-${randomUUID()}${extension}`;
    const storagePath = `${env.SUPABASE_PUBLIC_FOLDER}/${yyyy}/${mm}/${filename}`;

    const upload = await this.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, {
        upsert: false,
        contentType: resolveContentType(input.localPath, input.mediaType),
        cacheControl: "3600"
      });

    if (upload.error) {
      throw new AppError(`Supabase upload failed: ${upload.error.message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502
      });
    }

    const publicUrlResult = this.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = publicUrlResult.data.publicUrl;
    if (!publicUrl) {
      throw new AppError("Supabase did not return a public URL", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502
      });
    }

    this.storageLogger.info("Media uploaded to storage", {
      provider: "supabase",
      storagePath
    });

    return { storagePath, publicUrl };
  }

  private resolveLocalPublicUrl(localPath: string): UploadedMediaResult {
    if (!env.MEDIA_PUBLIC_BASE_URL) {
      throw new AppError("MEDIA_PUBLIC_BASE_URL is required for local media provider", {
        code: "VALIDATION_ERROR",
        statusCode: 500
      });
    }
    const filename = path.basename(localPath);
    const publicUrl = `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/${filename}`;
    return {
      storagePath: filename,
      publicUrl
    };
  }
}
