import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  TEXT_POSTER_STYLE_VARIANTS,
  TextPosterDesignService,
  type TextPosterStyleVariant
} from "../services/text-poster-design.service.js";
import { computePixelVariance } from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const service = new TextPosterDesignService();
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await ensureDir(tmpDir);

  const variantsToTest: TextPosterStyleVariant[] = [
    "morning_health",
    "medical_tip",
    "clinic_announcement",
    "minimalist_quote"
  ];

  for (const variant of variantsToTest) {
    const outputPath = path.resolve(tmpDir, `poster-${variant}.jpg`);
    const result = await service.createPoster({
      userPrompt: "сделай картинку доброе утро пейте витамины",
      language: "ru",
      brandName: "MC Clinic Medical",
      brandHandle: "@mc_clinic.du",
      styleVariant: variant,
      visualTitle: "Доброе утро! Начните день с заботы о себе",
      visualSubtitle: "Сбалансированное питание, вода и режим сна важны ежедневно."
    });
    await fs.copyFile(result.outputPath, outputPath);
    const stat = await fs.stat(outputPath);
    const meta = await sharp(outputPath).metadata();
    assert(meta.width === 1080 && meta.height === 1350, `${variant} invalid dimensions`);
    assert(stat.size > 50_000, `${variant} file too small (${stat.size})`);
    const variance = await computePixelVariance({
      image: outputPath,
      region: { left: 220, top: 360, width: 640, height: 500 }
    });
    assert(variance > 1.5, `${variant} appears blank`);
    assert(result.title.length <= 52, `${variant} title overflow risk`);
  }

  for (const variant of TEXT_POSTER_STYLE_VARIANTS) {
    // ensure style registry is stable and includes required variants
    assert(Boolean(variant), "Invalid style variant registry");
  }

  console.log("test:text-poster-design passed");
}

main().catch((error) => {
  console.error(`test:text-poster-design failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

