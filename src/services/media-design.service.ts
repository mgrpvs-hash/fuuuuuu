import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { Language } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { ensureDir } from "../utils/fs.js";
import { logger } from "../utils/logger.js";
import {
  MEDIA_DESIGN_TEMPLATE_IDS,
  getMediaDesignTemplate
} from "./media-design/templates/index.js";
import { MediaDesignTemplate, MediaDesignTemplateId } from "./media-design/templates/types.js";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const DESIGN_VERSION = "photo-v4";
const TITLE_LINE_HEIGHT_RATIO = 1.12;
const TITLE_FONT_SIZE_STEPS = [56, 54, 52, 50, 48];
const MIN_CENTER_VARIANCE = 1.5;

const DANGEROUS_PATTERNS = [
  /100%\s*результат/gi,
  /гарант/gi,
  /без\s*риска/gi,
  /лучшее\s*лечение/gi,
  /лучший\s*метод/gi,
  /полное\s*выздоровление/gi,
  /полностью\s*вылечит/gi,
  /before\s*\/?\s*after/gi
];

const RU_SAFE_TITLES = [
  "Современное пространство для ухода",
  "Комфорт и внимание к пациентам",
  "Профессиональная медицинская помощь",
  "Новые возможности для диагностики"
];

const EN_SAFE_TITLES = [
  "Modern care space",
  "Comfort-focused patient care",
  "Professional medical support",
  "Modern diagnostic capabilities"
];

type WrapResult = {
  lines: string[];
  truncated: boolean;
};

type TitleLayout = {
  title: string;
  lines: string[];
  fontSize: number;
  wasTruncated: boolean;
};

type LoadedImage = {
  buffer: Buffer;
  kind: "buffer" | "path" | "url";
  sourceReference: string;
  pathExists: boolean;
  fileSize: number;
  width: number;
  height: number;
};

type BottomTypography = {
  brandSize: number;
  handleSize: number;
  disclaimerSize: number;
  iconEnabled: boolean;
  disclaimerText: string;
};

export const MEDIA_DESIGN_VARIANTS = MEDIA_DESIGN_TEMPLATE_IDS;
export type MediaDesignVariant = MediaDesignTemplateId;
export type MediaDesignImageSource = Buffer | string;

type CreateBrandedPostImageInput = {
  sourcePath?: string;
  sourceImage?: MediaDesignImageSource;
  language: Language;
  title?: string | null;
  subtitle?: string | null;
  bulletPoints?: string[];
  overlayDensity?: "minimal" | "medium" | "detailed";
  brand?: string;
  handle?: string;
  disclaimer?: string;
  outputPath?: string;
  variant?: MediaDesignTemplateId;
};

type CreateBrandedPostImageResult = {
  outputPath: string;
  designVersion: string;
  designVariant: MediaDesignTemplateId;
  imageAreaMode: "contain_full_photo";
  titleUsed: string;
  titleLines: string[];
  titleWasTruncated: boolean;
  source: {
    inputKind: "buffer" | "path" | "url";
    sourceReference: string;
    pathExists: boolean;
    fileSize: number;
    width: number;
    height: number;
  };
  output: {
    width: number;
    height: number;
    fileSize: number;
    centerVariance: number;
  };
  layoutMetadata: {
    mode: string;
    topZone: { x: number; y: number; width: number; height: number };
    imageZone: { x: number; y: number; width: number; height: number };
    bottomZone: { x: number; y: number; width: number; height: number };
    iconEnabled: boolean;
    overlayDensity: "minimal" | "medium" | "detailed";
    bulletCount: number;
  };
};

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

function measureCharWidth(char: string, fontSize: number): number {
  if (char === " ") return fontSize * 0.33;
  if (/[.,:;!'"`]/.test(char)) return fontSize * 0.28;
  if (/[ilIjt|]/.test(char)) return fontSize * 0.34;
  if (/[WwMm@#&%]/.test(char)) return fontSize * 0.78;
  if (/[0-9]/.test(char)) return fontSize * 0.56;
  return fontSize * 0.6;
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += measureCharWidth(char, fontSize);
  }
  return width;
}

function fitWithEllipsis(text: string, maxWidth: number, fontSize: number): string {
  const ellipsis = "…";
  if (estimateTextWidth(text, fontSize) <= maxWidth) {
    return text;
  }

  let candidate = text.trim();
  while (candidate.length > 1 && estimateTextWidth(`${candidate}${ellipsis}`, fontSize) > maxWidth) {
    candidate = candidate.slice(0, -1).trimEnd();
  }
  return `${candidate}${ellipsis}`;
}

function wrapText(input: { text: string; maxWidth: number; fontSize: number; maxLines: number }): WrapResult {
  const normalized = input.text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { lines: [], truncated: false };
  }

  const safeWidth = Math.floor(input.maxWidth * 0.96);
  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  let truncated = false;

  const pushCurrentLine = () => {
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (estimateTextWidth(candidate, input.fontSize) <= safeWidth) {
      currentLine = candidate;
      continue;
    }

    if (!currentLine) {
      currentLine = fitWithEllipsis(word, safeWidth, input.fontSize);
      pushCurrentLine();
    } else {
      pushCurrentLine();
      currentLine =
        estimateTextWidth(word, input.fontSize) <= safeWidth
          ? word
          : fitWithEllipsis(word, safeWidth, input.fontSize);
    }

    if (lines.length >= input.maxLines) {
      truncated = true;
      break;
    }
  }

  if (!truncated && currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  if (lines.length > input.maxLines) {
    lines.length = input.maxLines;
    truncated = true;
  }

  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = fitWithEllipsis(lines[lines.length - 1], safeWidth, input.fontSize);
  } else if (lines.length === input.maxLines) {
    const consumedWords = lines.join(" ").split(" ").length;
    if (consumedWords < words.length) {
      truncated = true;
      lines[lines.length - 1] = fitWithEllipsis(lines[lines.length - 1], safeWidth, input.fontSize);
    }
  }

  return {
    lines: lines.slice(0, input.maxLines),
    truncated
  };
}

function pickFallbackTitle(language: Language, variant: MediaDesignTemplateId): string {
  const source = language === "en" ? EN_SAFE_TITLES : RU_SAFE_TITLES;
  const variantIndex = MEDIA_DESIGN_TEMPLATE_IDS.indexOf(variant);
  const safeIndex = variantIndex >= 0 ? variantIndex : 0;
  return source[safeIndex % source.length];
}

function resolveTitleLayout(input: {
  rawTitle: string | null | undefined;
  language: Language;
  variant: MediaDesignTemplateId;
  maxWidth: number;
  maxHeight: number;
}): TitleLayout {
  const limit = input.language === "ru" ? 52 : 48;
  const cleaned = sanitizeMedicalTitle(String(input.rawTitle ?? ""));
  const initialTitle =
    cleaned.length > 0 && cleaned.length <= limit ? cleaned : pickFallbackTitle(input.language, input.variant);
  const titleChangedFromInput = cleaned !== initialTitle;

  const tryLayout = (titleCandidate: string): TitleLayout | null => {
    for (const fontSize of TITLE_FONT_SIZE_STEPS) {
      const wrapped = wrapText({
        text: titleCandidate,
        maxWidth: input.maxWidth,
        fontSize,
        maxLines: 2
      });
      const lineHeight = Math.round(fontSize * TITLE_LINE_HEIGHT_RATIO);
      const totalHeight = wrapped.lines.length * lineHeight;
      if (wrapped.lines.length > 0 && wrapped.lines.length <= 2 && totalHeight <= input.maxHeight) {
        return {
          title: titleCandidate,
          lines: wrapped.lines,
          fontSize,
          wasTruncated: wrapped.truncated || titleChangedFromInput
        };
      }
    }
    return null;
  };

  const primary = tryLayout(initialTitle);
  if (primary) return primary;

  const fallback = pickFallbackTitle(input.language, input.variant);
  const fallbackLayout = tryLayout(fallback);
  if (fallbackLayout) return { ...fallbackLayout, wasTruncated: true };

  return {
    title: fallback,
    lines: [fitWithEllipsis(fallback, input.maxWidth, 48)],
    fontSize: 48,
    wasTruncated: true
  };
}

function validateTemplate(template: MediaDesignTemplate): void {
  const zones = [template.topZone, template.imageZone, template.bottomZone];
  for (const zone of zones) {
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > CANVAS_WIDTH || zone.y + zone.height > CANVAS_HEIGHT) {
      throw new AppError(`Media design template ${template.id} has invalid zone boundaries`, {
        code: "VALIDATION_ERROR",
        statusCode: 500
      });
    }
  }

  const verticalGapA = template.imageZone.y - (template.topZone.y + template.topZone.height);
  const verticalGapB = template.bottomZone.y - (template.imageZone.y + template.imageZone.height);
  if (template.mode !== "split_layout" && (verticalGapA < template.minSpacing || verticalGapB < template.minSpacing)) {
    throw new AppError(`Media design template ${template.id} violates min spacing`, {
      code: "VALIDATION_ERROR",
      statusCode: 500
    });
  }
}

function roundedMask(width: number, height: number, radius: number): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`;
  return Buffer.from(svg);
}

async function applyRoundedCorners(input: Buffer, width: number, height: number, radius: number): Promise<Buffer> {
  return sharp(input)
    .ensureAlpha()
    .composite([{ input: roundedMask(width, height, radius), blend: "dest-in" }])
    .png()
    .toBuffer();
}

export async function computePixelVariance(input: {
  image: string | Buffer;
  region?: { left: number; top: number; width: number; height: number };
}): Promise<number> {
  const base = sharp(input.image).ensureAlpha();
  const metadata = await base.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) return 0;

  let pipeline = sharp(input.image).ensureAlpha();
  if (input.region) {
    const region = {
      left: Math.max(0, Math.min(width - 1, Math.floor(input.region.left))),
      top: Math.max(0, Math.min(height - 1, Math.floor(input.region.top))),
      width: Math.max(1, Math.min(width, Math.floor(input.region.width))),
      height: Math.max(1, Math.min(height, Math.floor(input.region.height)))
    };
    pipeline = pipeline.extract(region);
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  if (channels < 3 || data.length === 0) return 0;

  const luminance: number[] = [];
  for (let index = 0; index < data.length; index += channels) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    luminance.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }

  const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  const variance =
    luminance.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / luminance.length;
  return Number(variance.toFixed(4));
}

function buildBackgroundSvg(template: MediaDesignTemplate): Buffer {
  const svg = `
  <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${template.backgroundGradient.start}" />
        <stop offset="100%" stop-color="${template.backgroundGradient.end}" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#bgGradient)" />
  </svg>`;
  return Buffer.from(svg);
}

function buildTextLinesSvg(input: {
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
  fontSize: number;
  color: string;
  align: "left" | "center";
  width: number;
}): string {
  const anchor = input.align === "center" ? "middle" : "start";
  const baseX = input.align === "center" ? input.x + Math.floor(input.width / 2) : input.x;
  return input.lines
    .map((line, index) => {
      const y = input.y + index * input.lineHeight;
      return `<text x="${baseX}" y="${y}" text-anchor="${anchor}" font-size="${input.fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${input.color}">${escapeXml(line)}</text>`;
    })
    .join("");
}

function resolveBottomTypography(input: {
  template: MediaDesignTemplate;
  brand: string;
  handle: string;
  disclaimer: string;
}): BottomTypography {
  let brandSize = 36;
  let handleSize = 30;
  let disclaimerSize = 24;
  let iconEnabled = false;

  const cardPadding = 32;
  const iconZoneWidth = 92;
  const textWidthFor = (icon: boolean) =>
    input.template.bottomZone.width - cardPadding * 2 - (icon ? iconZoneWidth : 0);

  const doesOverflow = (icon: boolean) => {
    const textWidth = textWidthFor(icon);
    const maxLineWidth = Math.max(
      estimateTextWidth(input.brand, brandSize),
      estimateTextWidth(input.handle, handleSize),
      estimateTextWidth(input.disclaimer, disclaimerSize)
    );
    return maxLineWidth > textWidth;
  };

  if (iconEnabled && doesOverflow(true)) {
    iconEnabled = false;
  }

  while (doesOverflow(iconEnabled) && (brandSize > 34 || handleSize > 28 || disclaimerSize > 22)) {
    if (brandSize > 34) brandSize -= 1;
    if (handleSize > 28) handleSize -= 1;
    if (disclaimerSize > 22) disclaimerSize -= 1;
  }

  const disclaimerText = doesOverflow(iconEnabled)
    ? fitWithEllipsis(input.disclaimer, textWidthFor(iconEnabled), disclaimerSize)
    : input.disclaimer;

  return {
    brandSize,
    handleSize,
    disclaimerSize,
    iconEnabled,
    disclaimerText
  };
}

export class MediaDesignService {
  private readonly serviceLogger = logger.child({ component: "media-design-service" });
  private variantCursor = 0;

  private pickVariant(explicitVariant?: MediaDesignTemplateId): MediaDesignTemplateId {
    if (explicitVariant) {
      return explicitVariant;
    }
    const next = MEDIA_DESIGN_TEMPLATE_IDS[this.variantCursor % MEDIA_DESIGN_TEMPLATE_IDS.length];
    this.variantCursor += 1;
    return next;
  }

  private async loadImageInput(input: MediaDesignImageSource): Promise<LoadedImage> {
    if (Buffer.isBuffer(input)) {
      if (!input.length) {
        throw new AppError("Media design failed: source image could not be loaded", {
          code: "VALIDATION_ERROR",
          statusCode: 400
        });
      }
      const metadata = await sharp(input).metadata();
      if (!metadata.width || !metadata.height) {
        throw new AppError("Media design failed: source image could not be loaded", {
          code: "VALIDATION_ERROR",
          statusCode: 400
        });
      }
      return {
        buffer: input,
        kind: "buffer",
        sourceReference: "buffer",
        pathExists: true,
        fileSize: input.length,
        width: metadata.width,
        height: metadata.height
      };
    }

    if (/^https:\/\//i.test(input)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(input, { method: "GET", signal: controller.signal });
        if (!response.ok) {
          throw new AppError("Media design failed: source image could not be loaded", {
            code: "EXTERNAL_SERVICE_ERROR",
            statusCode: response.status
          });
        }
        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.startsWith("image/")) {
          throw new AppError("Media design failed: source image could not be loaded", {
            code: "VALIDATION_ERROR",
            statusCode: 400
          });
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (!buffer.length) {
          throw new AppError("Media design failed: source image could not be loaded", {
            code: "VALIDATION_ERROR",
            statusCode: 400
          });
        }
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height) {
          throw new AppError("Media design failed: source image could not be loaded", {
            code: "VALIDATION_ERROR",
            statusCode: 400
          });
        }
        return {
          buffer,
          kind: "url",
          sourceReference: input,
          pathExists: true,
          fileSize: buffer.length,
          width: metadata.width,
          height: metadata.height
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    const localPath = path.resolve(input);
    const exists = fs.existsSync(localPath);
    if (!exists) {
      throw new AppError("Media design failed: source image could not be loaded", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    const stat = await fsPromises.stat(localPath);
    if (stat.size <= 0) {
      throw new AppError("Media design failed: source image could not be loaded", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    const buffer = await fsPromises.readFile(localPath);
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new AppError("Media design failed: source image could not be loaded", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    return {
      buffer,
      kind: "path",
      sourceReference: localPath,
      pathExists: true,
      fileSize: stat.size,
      width: metadata.width,
      height: metadata.height
    };
  }

  async createBrandedPostImage(input: CreateBrandedPostImageInput): Promise<CreateBrandedPostImageResult> {
    const sourceInput = input.sourceImage ?? input.sourcePath;
    if (!sourceInput) {
      throw new AppError("Media design failed: source image could not be loaded", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    const loaded = await this.loadImageInput(sourceInput);
    const designVariant = this.pickVariant(input.variant);
    const template = getMediaDesignTemplate(designVariant);
    validateTemplate(template);

    const brand = input.brand ?? "MC Clinic Medical";
    const handle = input.handle ?? "@mc_clinic.du";
    const disclaimer = input.disclaimer ?? "Информация носит ознакомительный характер";

    const outputPath =
      input.outputPath ??
      path.resolve(process.cwd(), "tmp", "processed-media", `post-${Date.now()}-${randomUUID()}.jpg`);
    await ensureDir(path.dirname(outputPath));

    const titleLayout = resolveTitleLayout({
      rawTitle: input.title,
      language: input.language,
      variant: designVariant,
      maxWidth: template.topZone.width - 72,
      maxHeight: template.topZone.height - 40
    });

    const blurredBackgroundBase = await sharp(loaded.buffer)
      .rotate()
      .resize(template.imageZone.width, template.imageZone.height, { fit: "cover", position: "attention" })
      .blur(template.imageBlurStrength)
      .modulate({ brightness: 0.9, saturation: 1 })
      .png()
      .toBuffer();
    const blurredBackground = await applyRoundedCorners(
      blurredBackgroundBase,
      template.imageZone.width,
      template.imageZone.height,
      template.imageZone.radius
    );

    const foregroundWidth = template.imageZone.width - template.imageForegroundInset * 2;
    const foregroundHeight = template.imageZone.height - template.imageForegroundInset * 2;
    const foregroundBase = await sharp(loaded.buffer)
      .rotate()
      .resize(foregroundWidth, foregroundHeight, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toBuffer();
    const foreground = await applyRoundedCorners(foregroundBase, foregroundWidth, foregroundHeight, 22);

    const bottomTypography = resolveBottomTypography({
      template,
      brand,
      handle,
      disclaimer
    });

    const topTitleLineHeight = Math.round(titleLayout.fontSize * TITLE_LINE_HEIGHT_RATIO);
    const subtitleSize = 30;
    const subtitleLineHeight = Math.round(subtitleSize * 1.2);
    const overlayDensity = input.overlayDensity ?? (designVariant === "educational" ? "detailed" : "medium");
    const topTitleY = template.topZone.y + 84;
    const topTitleX = template.topZone.x + 34;
    const topTagY = template.topZone.y + 40;
    const subtitleMaxWidth = template.topZone.width - 68;
    const subtitleText =
      overlayDensity === "minimal"
        ? ""
        : fitWithEllipsis(
            sanitizeMedicalTitle(input.subtitle ?? ""),
            subtitleMaxWidth,
            subtitleSize
          );
    const subtitleY = topTitleY + titleLayout.lines.length * topTitleLineHeight + 30;
    const textBlockX = template.bottomZone.x + 34;
    const textBlockY = template.bottomZone.y + 52;
    const iconX = template.bottomZone.x + template.bottomZone.width - 74;
    const iconY = template.bottomZone.y + 44;

    const rawBullets = (input.bulletPoints ?? [])
      .map((line) => sanitizeMedicalTitle(line))
      .map((line) => {
        const limit = input.language === "en" ? 50 : 55;
        return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
      })
      .filter(Boolean)
      .slice(0, 3);
    const bulletFontSize = 28;
    const bulletLineStep = 38;
    const bulletStartY = textBlockY + 102;
    const maxBulletArea = template.bottomZone.y + template.bottomZone.height - bulletStartY - 12;
    const maxBulletCount = Math.max(0, Math.min(3, Math.floor(maxBulletArea / bulletLineStep)));
    const bulletLines =
      overlayDensity === "detailed"
        ? rawBullets
            .slice(0, maxBulletCount)
            .map((line) => fitWithEllipsis(line, template.bottomZone.width - 90, bulletFontSize))
        : [];

    const bulletSvg = bulletLines
      .map((line, index) => {
        const y = bulletStartY + index * bulletLineStep;
        if (designVariant === "educational") {
          const cardY = y - 28;
          const cardHeight = 42;
          const cardWidth = template.bottomZone.width - 68;
          return `<rect x="${textBlockX - 10}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="#eef5fc" stroke="#d3e2f1" />
<text x="${textBlockX}" y="${y}" font-size="${bulletFontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="500" fill="${template.palette.disclaimer}">• ${escapeXml(line)}</text>`;
        }
        return `<text x="${textBlockX}" y="${y}" font-size="${bulletFontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="500" fill="${template.palette.disclaimer}">• ${escapeXml(line)}</text>`;
      })
      .join("");

    const iconSvg = bottomTypography.iconEnabled
      ? `<g><circle cx="${iconX}" cy="${iconY}" r="24" fill="#e7f1fb" stroke="#b8cee2" />
         <rect x="${iconX - 3}" y="${iconY - 15}" width="6" height="30" rx="3" fill="#2f6a9a" />
         <rect x="${iconX - 15}" y="${iconY - 3}" width="30" height="6" rx="3" fill="#2f6a9a" /></g>`
      : "";

    const overlaySvg = `
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#15324d" flood-opacity="0.12" />
        </filter>
      </defs>
      <rect x="${template.topZone.x}" y="${template.topZone.y}" rx="${template.topZone.radius}" ry="${template.topZone.radius}" width="${template.topZone.width}" height="${template.topZone.height}" fill="${template.palette.cardFill}" stroke="${template.palette.cardStroke}" stroke-width="2" />
      <text x="${template.topZone.x + 34}" y="${topTagY}" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="${template.palette.tag}">MC Clinic Medical</text>
      ${buildTextLinesSvg({
        lines: titleLayout.lines,
        x: topTitleX,
        y: topTitleY,
        lineHeight: topTitleLineHeight,
        fontSize: titleLayout.fontSize,
        color: template.palette.title,
        align: template.titleAlign,
        width: template.topZone.width - 68
      })}
      ${
        subtitleText
          ? `<text x="${topTitleX}" y="${subtitleY}" font-size="${subtitleSize}" font-family="Arial, Helvetica, sans-serif" font-weight="500" fill="${template.palette.handle}">${escapeXml(subtitleText)}</text>`
          : ""
      }

      <rect x="${template.imageZone.x}" y="${template.imageZone.y}" rx="${template.imageZone.radius}" ry="${template.imageZone.radius}" width="${template.imageZone.width}" height="${template.imageZone.height}" fill="none" stroke="#d9e6f2" stroke-width="2" filter="url(#softShadow)" />

      <rect x="${template.bottomZone.x}" y="${template.bottomZone.y}" rx="${template.bottomZone.radius}" ry="${template.bottomZone.radius}" width="${template.bottomZone.width}" height="${template.bottomZone.height}" fill="${template.palette.cardFill}" stroke="${template.palette.cardStroke}" stroke-width="2" />
      <text x="${textBlockX}" y="${textBlockY}" font-size="${bottomTypography.brandSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${template.palette.brand}">${escapeXml(brand)}</text>
      <text x="${textBlockX}" y="${textBlockY + 36}" font-size="${bottomTypography.handleSize}" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="${template.palette.handle}">${escapeXml(handle)}</text>
      <text x="${textBlockX}" y="${textBlockY + 70}" font-size="${bottomTypography.disclaimerSize}" font-family="Arial, Helvetica, sans-serif" fill="${template.palette.disclaimer}">${escapeXml(bottomTypography.disclaimerText)}</text>
      ${bulletSvg}
      ${iconSvg}
    </svg>`;

    const baseLayer =
      template.mode === "full_bleed"
        ? await sharp(loaded.buffer)
            .rotate()
            .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover", position: "attention" })
            .blur(Math.max(template.imageBlurStrength, 18))
            .modulate({ brightness: 0.72, saturation: 0.95 })
            .png()
            .toBuffer()
        : buildBackgroundSvg(template);

    await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 3,
        background: "#f5f9fd"
      }
    })
      .composite([
        { input: baseLayer, top: 0, left: 0 },
        { input: blurredBackground, top: template.imageZone.y, left: template.imageZone.x },
        {
          input: foreground,
          top: template.imageZone.y + template.imageForegroundInset,
          left: template.imageZone.x + template.imageForegroundInset
        },
        { input: Buffer.from(overlaySvg), top: 0, left: 0 }
      ])
      .jpeg({ quality: 93, mozjpeg: true })
      .toFile(outputPath);

    const outputStat = await fsPromises.stat(outputPath);
    const outputMeta = await sharp(outputPath).metadata();
    const centerVariance = await computePixelVariance({
      image: outputPath,
      region: {
        left: template.imageZone.x + Math.floor(template.imageZone.width * 0.2),
        top: template.imageZone.y + Math.floor(template.imageZone.height * 0.2),
        width: Math.floor(template.imageZone.width * 0.6),
        height: Math.floor(template.imageZone.height * 0.6)
      }
    });
    if (centerVariance < MIN_CENTER_VARIANCE) {
      throw new AppError("Media design failed: rendered image area appears blank", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    this.serviceLogger.info("Media design completed", {
      designVariant,
      sourceKind: loaded.kind,
      sourceWidth: loaded.width,
      sourceHeight: loaded.height,
      outputWidth: outputMeta.width ?? CANVAS_WIDTH,
      outputHeight: outputMeta.height ?? CANVAS_HEIGHT,
      centerVariance
    });

    return {
      outputPath,
      designVersion: `${DESIGN_VERSION}/${designVariant}`,
      designVariant,
      imageAreaMode: "contain_full_photo",
      titleUsed: titleLayout.title,
      titleLines: titleLayout.lines,
      titleWasTruncated: titleLayout.wasTruncated,
      source: {
        inputKind: loaded.kind,
        sourceReference: loaded.sourceReference,
        pathExists: loaded.pathExists,
        fileSize: loaded.fileSize,
        width: loaded.width,
        height: loaded.height
      },
      output: {
        width: outputMeta.width ?? CANVAS_WIDTH,
        height: outputMeta.height ?? CANVAS_HEIGHT,
        fileSize: outputStat.size,
        centerVariance
      },
      layoutMetadata: {
        mode: template.mode,
        topZone: {
          x: template.topZone.x,
          y: template.topZone.y,
          width: template.topZone.width,
          height: template.topZone.height
        },
        imageZone: {
          x: template.imageZone.x,
          y: template.imageZone.y,
          width: template.imageZone.width,
          height: template.imageZone.height
        },
        bottomZone: {
          x: template.bottomZone.x,
          y: template.bottomZone.y,
          width: template.bottomZone.width,
          height: template.bottomZone.height
        },
        iconEnabled: bottomTypography.iconEnabled,
        overlayDensity,
        bulletCount: bulletLines.length
      }
    };
  }
}

