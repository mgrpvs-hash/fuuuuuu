import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { Language } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { ensureDir } from "../utils/fs.js";

const DESIGN_VERSION = "video-v1";
const LONG_VIDEO_WARNING_SECONDS = 90;

function escapeFfmpegText(value: string): string {
  return value.replace(/[:\\']/g, "\\$&");
}

function fallbackTitle(language: Language): string {
  return language === "en" ? "Modern equipment at our clinic" : "Современное оборудование в клинике";
}

function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Number(data.format.duration ?? 0));
    });
  });
}

export class VideoDesignService {
  constructor() {
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }
  }

  async createStyledReel(input: {
    sourcePath: string;
    language: Language;
    title?: string | null;
    handle?: string;
    outputPath?: string;
  }): Promise<{
    outputPath: string;
    coverImagePath: string;
    designVersion: string;
    warning?: string;
  }> {
    const title = (input.title ?? "").trim() || fallbackTitle(input.language);
    const handle = input.handle ?? "@mc_clinic.du";
    const outputPath =
      input.outputPath ??
      path.resolve(process.cwd(), "tmp", "processed-media", `reel-${Date.now()}-${randomUUID()}.mp4`);
    const coverImagePath = path.resolve(process.cwd(), "tmp", "processed-media", `reel-cover-${Date.now()}-${randomUUID()}.jpg`);

    await ensureDir(path.dirname(outputPath));

    let warning: string | undefined;
    try {
      const duration = await probeDurationSeconds(input.sourcePath);
      if (duration > LONG_VIDEO_WARNING_SECONDS) {
        warning =
          "Видео длиннее рекомендованного лимита для MVP preview. Пожалуйста, проверьте итоговый рендер перед публикацией.";
      }
    } catch {
      warning = "Не удалось определить длительность видео до рендера.";
    }

    const escapedTitle = escapeFfmpegText(title);
    const escapedHandle = escapeFfmpegText(handle);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(input.sourcePath)
        .outputOptions([
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-preset veryfast",
          "-crf 22",
          "-r 30"
        ])
        .videoFilters([
          "scale=1080:1920:force_original_aspect_ratio=increase",
          "crop=1080:1920",
          "drawbox=x=0:y=0:w=1080:h=250:color=white@0.9:t=fill:enable='between(t,0,2.2)'",
          `drawtext=text='${escapedTitle}':fontcolor=black:fontsize=52:x=56:y=94:enable='between(t,0,2.2)'`,
          `drawtext=text='${escapedHandle}':fontcolor=white:fontsize=40:x=w-tw-56:y=h-th-44:box=1:boxcolor=0x00000088`
        ])
        .audioCodec("aac")
        .videoCodec("libx264")
        .save(outputPath)
        .on("end", () => resolve())
        .on("error", (error) => reject(error));
    }).catch((error) => {
      throw new AppError(`Video design processing failed: ${error.message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 500
      });
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg(outputPath)
        .outputOptions(["-vframes 1"])
        .save(coverImagePath)
        .on("end", () => resolve())
        .on("error", (error) => reject(error));
    }).catch((error) => {
      throw new AppError(`Video cover generation failed: ${error.message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 500
      });
    });

    return {
      outputPath,
      coverImagePath,
      designVersion: DESIGN_VERSION,
      warning
    };
  }
}

