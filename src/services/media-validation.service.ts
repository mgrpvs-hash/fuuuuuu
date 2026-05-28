import path from "node:path";
import { promises as fs } from "node:fs";

import { env } from "../config/env.js";
import { MediaType } from "../types/domain.js";
import { AppError } from "../types/errors.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

export class MediaValidationService {
  validateTelegramMetadata(input: {
    mediaType: MediaType;
    mimeType?: string;
    fileSize?: number;
    durationSeconds?: number;
  }): void {
    if (input.fileSize && input.fileSize > env.MAX_MEDIA_FILE_SIZE_MB * 1024 * 1024) {
      throw new AppError(
        `Media file is too large. Max size is ${env.MAX_MEDIA_FILE_SIZE_MB}MB.`,
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }

    if (input.mediaType === "video" && input.durationSeconds && input.durationSeconds > env.MAX_VIDEO_DURATION_SECONDS) {
      throw new AppError(
        `Video is too long. Max duration is ${env.MAX_VIDEO_DURATION_SECONDS} seconds.`,
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }

    if (input.mimeType) {
      const normalized = input.mimeType.toLowerCase();
      if (input.mediaType === "image" && !normalized.startsWith("image/")) {
        throw new AppError("Invalid image mime type.", {
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: { mimeType: input.mimeType }
        });
      }
      if (input.mediaType === "video" && !normalized.startsWith("video/")) {
        throw new AppError("Invalid video mime type.", {
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: { mimeType: input.mimeType }
        });
      }
    }
  }

  async validateStoredFile(filePath: string, mediaType: MediaType): Promise<void> {
    const extension = path.extname(filePath).toLowerCase();
    if (mediaType === "image" && !IMAGE_EXTENSIONS.has(extension)) {
      throw new AppError("Unsupported image format.", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { extension }
      });
    }
    if (mediaType === "video" && !VIDEO_EXTENSIONS.has(extension)) {
      throw new AppError("Unsupported video format.", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { extension }
      });
    }

    const stat = await fs.stat(filePath);
    if (stat.size > env.MAX_MEDIA_FILE_SIZE_MB * 1024 * 1024) {
      throw new AppError(
        `Downloaded media exceeds max configured size (${env.MAX_MEDIA_FILE_SIZE_MB}MB).`,
        { code: "VALIDATION_ERROR", statusCode: 400 }
      );
    }
  }
}
