import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { MediaDesignService } from "../services/media-design.service.js";
import { ensureDir } from "../utils/fs.js";

async function main(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await ensureDir(tmpDir);

  const sampleInput = path.resolve(tmpDir, "test-media-source.jpg");
  const outputPath = path.resolve(tmpDir, "test-branded-post.jpg");

  await sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 3,
      background: "#8bb4d8"
    }
  })
    .jpeg({ quality: 95 })
    .toFile(sampleInput);

  const service = new MediaDesignService();
  await service.createBrandedPostImage({
    sourcePath: sampleInput,
    language: "ru",
    outputPath
  });

  const stat = await fs.stat(outputPath);
  if (!stat.isFile()) {
    throw new Error("Output file was not created");
  }

  const metadata = await sharp(outputPath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const format = metadata.format ?? "unknown";

  if (width !== 1080 || height !== 1350) {
    throw new Error(`Unexpected output dimensions: ${width}x${height}`);
  }

  if (format !== "jpeg" && format !== "png") {
    throw new Error(`Unexpected output format: ${format}`);
  }

  console.log("test:media-design passed", {
    outputPath,
    width,
    height,
    format
  });
}

main().catch((error) => {
  console.error(`test:media-design failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

