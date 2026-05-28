import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { env } from "../config/env.js";
import { AppDatabase } from "../db/database.js";
import { MediaDesignService, computePixelVariance } from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

function resolveSourceFromLatestMedia(media: {
  local_path: string;
  storage_url_original: string | null;
  storage_url: string | null;
}): string {
  if (media.local_path && fs.existsSync(media.local_path)) {
    return media.local_path;
  }
  const fallbackUrl = media.storage_url_original ?? media.storage_url;
  if (fallbackUrl && /^https:\/\//i.test(fallbackUrl)) {
    return fallbackUrl;
  }
  throw new Error("Latest media does not have a valid local path or HTTPS original URL");
}

async function main(): Promise<void> {
  const db = await AppDatabase.init(env.DATABASE_URL);
  const latest = db.getLatestMediaItemWithStorageUrl("image");
  if (!latest) {
    throw new Error("No latest media item found. Send a new photo in Telegram first.");
  }

  const source = resolveSourceFromLatestMedia(latest);
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await ensureDir(tmpDir);
  const outputPath = path.resolve(tmpDir, "latest-processed-preview.jpg");

  const service = new MediaDesignService();
  const result = await service.createBrandedPostImage({
    sourceImage: source,
    language: "ru",
    title: "Современное пространство для ухода",
    outputPath
  });

  const stat = await fsPromises.stat(outputPath);
  const outputMeta = await sharp(outputPath).metadata();
  const outputWidth = outputMeta.width ?? 0;
  const outputHeight = outputMeta.height ?? 0;

  if (outputWidth !== 1080 || outputHeight !== 1350) {
    throw new Error(`Unexpected output dimensions: ${outputWidth}x${outputHeight}`);
  }
  if (stat.size <= 50_000) {
    throw new Error(`Processed preview file is too small: ${stat.size} bytes`);
  }

  const centerVariance = await computePixelVariance({
    image: outputPath,
    region: { left: 300, top: 430, width: 480, height: 360 }
  });
  if (centerVariance <= 1.5) {
    throw new Error(`Center area appears blank (variance=${centerVariance})`);
  }

  console.log("test:media-design-latest passed", {
    originalDimensions: `${result.source.width}x${result.source.height}`,
    outputDimensions: `${outputWidth}x${outputHeight}`,
    outputPath: result.outputPath,
    designVariant: result.designVariant,
    imageAreaMode: result.imageAreaMode,
    centerVariance,
    outputFileSize: stat.size
  });
}

main().catch((error) => {
  console.error(
    `test:media-design-latest failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});

