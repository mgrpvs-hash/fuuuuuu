import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

import { Language } from "../types/domain.js";
import { ensureDir } from "../utils/fs.js";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const DESIGN_VERSION = "photo-v1";

const DANGEROUS_PATTERNS = [
  /100%\s*результат/gi,
  /гарантированное\s*лечение/gi,
  /без\s*риска/gi,
  /полностью\s*вылечит/gi,
  /лучший\s*метод/gi,
  /диагноз\s*без\s*врача/gi
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeMedicalTitle(value: string): string {
  let result = value.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s+/g, " ").trim();
}

function fallbackTitle(language: Language): string {
  if (language === "en") {
    return "Modern equipment at our clinic";
  }
  return "Современное оборудование в клинике";
}

function resolveDesignTitle(inputTitle: string | null | undefined, language: Language): string {
  const clean = sanitizeMedicalTitle(String(inputTitle ?? ""));
  if (clean.length > 6) {
    return clean.slice(0, 90);
  }
  return fallbackTitle(language);
}

function buildOverlaySvg(input: { title: string; brand: string; handle: string; disclaimer: string }): Buffer {
  const title = escapeXml(input.title);
  const brand = escapeXml(input.brand);
  const handle = escapeXml(input.handle);
  const disclaimer = escapeXml(input.disclaimer);
  const svg = `
  <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f4f8fc" />
        <stop offset="100%" stop-color="#edf4fb" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#17324f" flood-opacity="0.12" />
      </filter>
    </defs>
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#bgGradient)" />
    <rect x="56" y="148" rx="34" ry="34" width="968" height="986" fill="#ffffff" filter="url(#shadow)" />
    <rect x="72" y="164" rx="26" ry="26" width="936" height="954" fill="none" stroke="#d9e7f5" stroke-width="2" />
    <rect x="72" y="56" rx="24" ry="24" width="936" height="112" fill="#ffffff" stroke="#d9e7f5" />
    <text x="108" y="124" font-size="44" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#16324f">${title}</text>
    <rect x="72" y="1150" rx="22" ry="22" width="936" height="140" fill="#ffffff" stroke="#d9e7f5" />
    <text x="108" y="1205" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#16324f">${brand}</text>
    <text x="108" y="1245" font-size="30" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="#2f6ea6">${handle}</text>
    <text x="108" y="1278" font-size="22" font-family="Arial, Helvetica, sans-serif" fill="#667b92">${disclaimer}</text>
  </svg>`;
  return Buffer.from(svg);
}

export class MediaDesignService {
  async createBrandedPostImage(input: {
    sourcePath: string;
    language: Language;
    title?: string | null;
    brand?: string;
    handle?: string;
    disclaimer?: string;
    outputPath?: string;
  }): Promise<{ outputPath: string; designVersion: string; titleUsed: string }> {
    const titleUsed = resolveDesignTitle(input.title, input.language);
    const brand = input.brand ?? "MC Clinic Medical";
    const handle = input.handle ?? "@mc_clinic.du";
    const disclaimer = input.disclaimer ?? "Информация носит ознакомительный характер";

    const outputPath =
      input.outputPath ??
      path.resolve(process.cwd(), "tmp", "processed-media", `post-${Date.now()}-${randomUUID()}.jpg`);
    await ensureDir(path.dirname(outputPath));

    const preparedSource = await sharp(input.sourcePath)
      .rotate()
      .resize(900, 910, { fit: "cover", position: "attention" })
      .jpeg({ quality: 93, mozjpeg: true })
      .toBuffer();

    const overlay = buildOverlaySvg({
      title: titleUsed,
      brand,
      handle,
      disclaimer
    });

    await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 3,
        background: "#f4f8fc"
      }
    })
      .composite([
        { input: overlay, top: 0, left: 0 },
        { input: preparedSource, top: 190, left: 90 }
      ])
      .jpeg({ quality: 93, mozjpeg: true })
      .toFile(outputPath);

    return {
      outputPath,
      designVersion: DESIGN_VERSION,
      titleUsed
    };
  }
}

