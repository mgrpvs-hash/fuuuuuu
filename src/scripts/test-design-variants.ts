import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { MEDIA_DESIGN_VARIANTS, MediaDesignService, computePixelVariance } from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function createSample(filePath: string): Promise<void> {
  const buffer = await sharp({
    create: {
      width: 1800,
      height: 1200,
      channels: 3,
      background: "#c9d9e8"
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1800" height="1200" xmlns="http://www.w3.org/2000/svg">
             <rect width="1800" height="1200" fill="#dae6ef"/>
             <rect x="140" y="140" width="1520" height="920" rx="48" fill="#f7fbff" stroke="#9bb4c9" stroke-width="10"/>
             <rect x="240" y="260" width="480" height="360" rx="26" fill="#b6cede"/>
             <rect x="780" y="260" width="760" height="360" rx="26" fill="#c9dce9"/>
             <rect x="240" y="670" width="1300" height="280" rx="28" fill="#a8c1d2"/>
           </svg>`
        )
      }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
  await fs.writeFile(filePath, buffer);
}

async function main(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await ensureDir(tmpDir);
  const sample = path.resolve(tmpDir, "variant-sample.jpg");
  await createSample(sample);

  const service = new MediaDesignService();
  const layoutSet = new Set<string>();

  for (const variant of MEDIA_DESIGN_VARIANTS) {
    const output = path.resolve(tmpDir, `variant-${variant}.jpg`);
    const result = await service.createBrandedPostImage({
      sourcePath: sample,
      language: "ru",
      title: "Современное пространство для ухода",
      variant,
      outputPath: output
    });

    const meta = await sharp(output).metadata();
    assert(meta.width === 1080 && meta.height === 1350, `Invalid dimensions for ${variant}`);
    assert(result.titleLines.length <= 2, `Title overflow for ${variant}`);

    const variance = await computePixelVariance({
      image: output,
      region: {
        left: result.layoutMetadata.imageZone.x + Math.floor(result.layoutMetadata.imageZone.width * 0.2),
        top: result.layoutMetadata.imageZone.y + Math.floor(result.layoutMetadata.imageZone.height * 0.2),
        width: Math.floor(result.layoutMetadata.imageZone.width * 0.6),
        height: Math.floor(result.layoutMetadata.imageZone.height * 0.6)
      }
    });
    assert(variance > 1.5, `Blank center detected for ${variant}`);

    const layoutSignature = JSON.stringify({
      mode: result.layoutMetadata.mode,
      top: result.layoutMetadata.topZone,
      image: result.layoutMetadata.imageZone,
      bottom: result.layoutMetadata.bottomZone
    });
    layoutSet.add(layoutSignature);
  }

  assert(
    layoutSet.size >= 6,
    `Variants are not visually different enough. Distinct layout signatures: ${layoutSet.size}`
  );
  console.log("test:design-variants passed", {
    variants: MEDIA_DESIGN_VARIANTS.length,
    distinctLayouts: layoutSet.size
  });
}

main().catch((error) => {
  console.error(`test:design-variants failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

