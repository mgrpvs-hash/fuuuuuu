import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  MEDIA_DESIGN_VARIANTS,
  MediaDesignService,
  type MediaDesignVariant
} from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

const LONG_TITLE_RU =
  "Открытие новой медицинской комнаты — современное пространство для качественного ухода и комфорта пациентов";

async function assertOutputImage(outputPath: string): Promise<{ width: number; height: number; format: string }> {
  const stat = await fs.stat(outputPath);
  if (!stat.isFile()) {
    throw new Error(`Output file does not exist: ${outputPath}`);
  }

  const metadata = await sharp(outputPath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const format = metadata.format ?? "unknown";

  if (width !== 1080 || height !== 1350) {
    throw new Error(`Unexpected dimensions for ${outputPath}: ${width}x${height}`);
  }
  if (format !== "jpeg" && format !== "png") {
    throw new Error(`Unexpected format for ${outputPath}: ${format}`);
  }
  return { width, height, format };
}

function getOutputPath(tmpDir: string, variant: MediaDesignVariant): string {
  if (variant === "clean_light") {
    return path.resolve(tmpDir, "test-branded-post-clean-light.jpg");
  }
  if (variant === "premium_card") {
    return path.resolve(tmpDir, "test-branded-post-premium-card.jpg");
  }
  return path.resolve(tmpDir, "test-branded-post-equipment-focus.jpg");
}

async function main(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await ensureDir(tmpDir);

  const sampleInput = path.resolve(tmpDir, "test-media-source.jpg");
  await sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 3,
      background: "#8fb2cc"
    }
  })
    .jpeg({ quality: 95 })
    .toFile(sampleInput);

  const service = new MediaDesignService();

  for (const variant of MEDIA_DESIGN_VARIANTS) {
    const outputPath = getOutputPath(tmpDir, variant);
    const result = await service.createBrandedPostImage({
      sourcePath: sampleInput,
      language: "ru",
      title: LONG_TITLE_RU,
      variant,
      outputPath
    });

    const imageMeta = await assertOutputImage(outputPath);
    if (result.titleLines.length > 2) {
      throw new Error(`Title overflow: expected <=2 lines, got ${result.titleLines.length} (${variant})`);
    }

    console.log("media-design debug", {
      designVariant: result.designVariant,
      titleLines: result.titleLines,
      titleWasTruncated: result.titleWasTruncated,
      outputPath: result.outputPath,
      dimensions: `${imageMeta.width}x${imageMeta.height}`
    });
  }

  console.log("test:media-design passed");
}

main().catch((error) => {
  console.error(`test:media-design failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

