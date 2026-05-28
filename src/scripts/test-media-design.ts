import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  MEDIA_DESIGN_VARIANTS,
  MediaDesignService,
  computePixelVariance,
  type MediaDesignVariant
} from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

const LONG_TITLE_RU =
  "Открытие новой медицинской комнаты — современное пространство для качественного ухода и комфорта пациентов";

async function createHorizontalRoomSample(filePath: string): Promise<void> {
  const base = await sharp({
    create: {
      width: 1800,
      height: 1000,
      channels: 3,
      background: "#cddce8"
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1800" height="1000" xmlns="http://www.w3.org/2000/svg">
             <rect width="1800" height="420" fill="#b7cee0"/>
             <rect y="420" width="1800" height="580" fill="#dbe6ef"/>
             <rect x="160" y="280" width="1480" height="520" rx="36" fill="#f8fbff" stroke="#8fa9be" stroke-width="8"/>
             <rect x="250" y="360" width="250" height="180" rx="20" fill="#b6cfdf"/>
             <rect x="560" y="360" width="250" height="180" rx="20" fill="#c2d7e5"/>
             <rect x="870" y="360" width="250" height="180" rx="20" fill="#aac5d8"/>
             <rect x="1180" y="360" width="250" height="180" rx="20" fill="#c6dbe8"/>
           </svg>`
        )
      }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
  await fs.writeFile(filePath, base);
}

async function createVerticalEquipmentSample(filePath: string): Promise<void> {
  const base = await sharp({
    create: {
      width: 1100,
      height: 1900,
      channels: 3,
      background: "#d7e6f0"
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1100" height="1900" xmlns="http://www.w3.org/2000/svg">
             <rect width="1100" height="1900" fill="#e8f1f8"/>
             <rect x="190" y="170" width="720" height="1560" rx="44" fill="#fdfefe" stroke="#9ab5ca" stroke-width="10"/>
             <rect x="280" y="280" width="540" height="340" rx="28" fill="#bfd4e3"/>
             <rect x="320" y="700" width="460" height="740" rx="32" fill="#cfe0ec"/>
             <rect x="390" y="780" width="320" height="580" rx="24" fill="#9ebdd1"/>
           </svg>`
        )
      }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
  await fs.writeFile(filePath, base);
}

async function assertOutputImage(outputPath: string): Promise<{ width: number; height: number; format: string; fileSize: number }> {
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
  if (stat.size <= 50_000) {
    throw new Error(`Output file too small for ${outputPath}: ${stat.size} bytes`);
  }
  return { width, height, format, fileSize: stat.size };
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

  const horizontalSource = path.resolve(tmpDir, "test-room-horizontal.jpg");
  const verticalSource = path.resolve(tmpDir, "test-equipment-vertical.jpg");
  await createHorizontalRoomSample(horizontalSource);
  await createVerticalEquipmentSample(verticalSource);

  const service = new MediaDesignService();

  for (const variant of MEDIA_DESIGN_VARIANTS) {
    const outputPath = getOutputPath(tmpDir, variant);
    const sourcePath = variant === "premium_card" ? verticalSource : horizontalSource;
    const result = await service.createBrandedPostImage({
      sourcePath,
      language: "ru",
      title: LONG_TITLE_RU,
      variant,
      outputPath
    });

    const imageMeta = await assertOutputImage(outputPath);
    if (result.titleLines.length > 2) {
      throw new Error(`Title overflow: expected <=2 lines, got ${result.titleLines.length} (${variant})`);
    }

    const centerVariance = await computePixelVariance({
      image: outputPath,
      region: { left: 300, top: 430, width: 480, height: 360 }
    });
    if (centerVariance <= 1.5) {
      throw new Error(`Center area appears blank for ${variant}: variance=${centerVariance}`);
    }

    console.log("media-design debug", {
      designVariant: result.designVariant,
      titleLines: result.titleLines,
      titleWasTruncated: result.titleWasTruncated,
      outputPath: result.outputPath,
      dimensions: `${imageMeta.width}x${imageMeta.height}`,
      imageAreaMode: result.imageAreaMode,
      centerVariance
    });
  }

  console.log("test:media-design passed");
}

main().catch((error) => {
  console.error(`test:media-design failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

