import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { Language } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { ensureDir } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const OUTER_PADDING = 64;
const DESIGN_VERSION = "photo-v3";
const TITLE_LINE_HEIGHT_RATIO = 1.12;
const TITLE_FONT_SIZE_STEPS = [56, 54, 52, 50, 48];
const IMAGE_AREA_MODE = "contain_full_photo";
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

export const MEDIA_DESIGN_VARIANTS = ["clean_light", "premium_card", "equipment_focus"] as const;
export type MediaDesignVariant = (typeof MEDIA_DESIGN_VARIANTS)[number];
export type MediaDesignImageSource = Buffer | string;

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

type VariantStyle = {
  gradientStart: string;
  gradientEnd: string;
  topCardFill: string;
  topCardStroke: string;
  topCardHeight: number;
  bottomCardFill: string;
  bottomCardStroke: string;
  bottomCardHeight: number;
  imageShadowOpacity: number;
  titleColor: string;
  brandColor: string;
  handleColor: string;
  disclaimerColor: string;
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

const VARIANT_STYLES: Record<MediaDesignVariant, VariantStyle> = {
  clean_light: {
    gradientStart: "#f5f9fd",
    gradientEnd: "#eef5fb",
    topCardFill: "#ffffff",
    topCardStroke: "#dbe7f3",
    topCardHeight: 150,
    bottomCardFill: "#ffffff",
    bottomCardStroke: "#dbe7f3",
    bottomCardHeight: 160,
    imageShadowOpacity: 0.12,
    titleColor: "#142e47",
    brandColor: "#13314d",
    handleColor: "#2b6699",
    disclaimerColor: "#5f7288"
  },
  premium_card: {
    gradientStart: "#f8fbff",
    gradientEnd: "#edf3fa",
    topCardFill: "#ffffff",
    topCardStroke: "#d4e1ef",
    topCardHeight: 156,
    bottomCardFill: "#fbfdff",
    bottomCardStroke: "#d4e1ef",
    bottomCardHeight: 170,
    imageShadowOpacity: 0.14,
    titleColor: "#122a41",
    brandColor: "#102d49",
    handleColor: "#255f92",
    disclaimerColor: "#566d86"
  },
  equipment_focus: {
    gradientStart: "#f3f8fe",
    gradientEnd: "#e9f2fa",
    topCardFill: "#ffffff",
    topCardStroke: "#d1deec",
    topCardHeight: 144,
    bottomCardFill: "#ffffff",
    bottomCardStroke: "#d1deec",
    bottomCardHeight: 158,
    imageShadowOpacity: 0.1,
    titleColor: "#122f4b",
    brandColor: "#113049",
    handleColor: "#2d6797",
    disclaimerColor: "#5d738a"
  }
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

function pickFallbackTitle(language: Language, variant: MediaDesignVariant): string {
  const source = language === "en" ? EN_SAFE_TITLES : RU_SAFE_TITLES;
  const variantIndex = MEDIA_DESIGN_VARIANTS.indexOf(variant);
  const safeIndex = variantIndex >= 0 ? variantIndex : 0;
  return source[safeIndex % source.length];
}

function resolveTitleLayout(input: {
  rawTitle: string | null | undefined;
  language: Language;
  variant: MediaDesignVariant;
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
  if (primary) {
    return primary;
  }

  const fallback = pickFallbackTitle(input.language, input.variant);
  const fallbackLayout = tryLayout(fallback);
  if (fallbackLayout) {
    return {
      ...fallbackLayout,
      wasTruncated: true
    };
  }

  const forcedFontSize = 48;
  const wrapped = wrapText({
    text: fallback,
    maxWidth: input.maxWidth,
    fontSize: forcedFontSize,
    maxLines: 2
  });
  return {
    title: fallback,
    lines: wrapped.lines.slice(0, 2),
    fontSize: forcedFontSize,
    wasTruncated: true
  };
}

function buildBaseBackgroundSvg(variant: MediaDesignVariant): Buffer {
  const style = VARIANT_STYLES[variant];
  const svg = `
  <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${style.gradientStart}" />
        <stop offset="100%" stop-color="${style.gradientEnd}" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#bgGradient)" />
  </svg>`;
  return Buffer.from(svg);
}

function buildChromeSvg(input: {
  variant: MediaDesignVariant;
  titleLines: string[];
  titleFontSize: number;
  brand: string;
  handle: string;
  disclaimer: string;
}): { svg: Buffer; imageFrame: { x: number; y: number; width: number; height: number } } {
  const style = VARIANT_STYLES[input.variant];
  const innerX = OUTER_PADDING;
  const innerY = OUTER_PADDING;
  const innerW = CANVAS_WIDTH - OUTER_PADDING * 2;

  const topCardY = innerY;
  const topCardH = style.topCardHeight;
  const gapTopToImage = 20;
  const gapImageToBottom = 20;
  const bottomCardY = CANVAS_HEIGHT - OUTER_PADDING - style.bottomCardHeight;
  const imageY = topCardY + topCardH + gapTopToImage;
  const imageH = bottomCardY - gapImageToBottom - imageY;

  const titleStartX = innerX + 40;
  const tagY = topCardY + 38;
  const titleStartY = topCardY + 92;
  const titleLineHeight = Math.round(input.titleFontSize * TITLE_LINE_HEIGHT_RATIO);

  const brand = escapeXml(input.brand);
  const handle = escapeXml(input.handle);
  const disclaimer = escapeXml(input.disclaimer);
  const titleLinesSvg = input.titleLines
    .map(
      (line, index) =>
        `<text x="${titleStartX}" y="${titleStartY + index * titleLineHeight}" font-size="${input.titleFontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${style.titleColor}">${escapeXml(line)}</text>`
    )
    .join("");

  const svg = `
  <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#15324d" flood-opacity="${style.imageShadowOpacity}" />
      </filter>
    </defs>

    <rect x="${innerX}" y="${topCardY}" rx="28" ry="28" width="${innerW}" height="${topCardH}" fill="${style.topCardFill}" stroke="${style.topCardStroke}" stroke-width="2" />
    <text x="${titleStartX}" y="${tagY}" font-size="26" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="${style.handleColor}">MC Clinic Medical</text>
    ${titleLinesSvg}

    <rect x="${innerX}" y="${imageY}" rx="28" ry="28" width="${innerW}" height="${imageH}" fill="none" stroke="#dfe9f3" stroke-width="2" filter="url(#softShadow)" />

    <rect x="${innerX}" y="${bottomCardY}" rx="26" ry="26" width="${innerW}" height="${style.bottomCardHeight}" fill="${style.bottomCardFill}" stroke="${style.bottomCardStroke}" stroke-width="2" />
    <text x="${innerX + 38}" y="${bottomCardY + 58}" font-size="36" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${style.brandColor}">${brand}</text>
    <text x="${innerX + 38}" y="${bottomCardY + 98}" font-size="30" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="${style.handleColor}">${handle}</text>
    <text x="${innerX + 38}" y="${bottomCardY + 136}" font-size="24" font-family="Arial, Helvetica, sans-serif" fill="${style.disclaimerColor}">${disclaimer}</text>

    <circle cx="${innerX + innerW - 88}" cy="${bottomCardY + 72}" r="30" fill="#e8f1fb" stroke="#b8cee2" />
    <rect x="${innerX + innerW - 92}" y="${bottomCardY + 54}" width="8" height="36" rx="4" fill="#2f6a9a" />
    <rect x="${innerX + innerW - 106}" y="${bottomCardY + 68}" width="36" height="8" rx="4" fill="#2f6a9a" />
  </svg>`;

  return {
    svg: Buffer.from(svg),
    imageFrame: {
      x: innerX,
      y: imageY,
      width: innerW,
      height: imageH
    }
  };
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
  if (!width || !height) {
    return 0;
  }

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
  if (channels < 3 || data.length === 0) {
    return 0;
  }

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

type CreateBrandedPostImageInput = {
  sourcePath?: string;
  sourceImage?: MediaDesignImageSource;
  language: Language;
  title?: string | null;
  brand?: string;
  handle?: string;
  disclaimer?: string;
  outputPath?: string;
  variant?: MediaDesignVariant;
};

type CreateBrandedPostImageResult = {
  outputPath: string;
  designVersion: string;
  designVariant: MediaDesignVariant;
  imageAreaMode: typeof IMAGE_AREA_MODE;
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
};

export class MediaDesignService {
  private readonly serviceLogger = logger.child({ component: "media-design-service" });
  private variantCursor = 0;

  private pickVariant(explicitVariant?: MediaDesignVariant): MediaDesignVariant {
    if (explicitVariant) {
      return explicitVariant;
    }
    const next = MEDIA_DESIGN_VARIANTS[this.variantCursor % MEDIA_DESIGN_VARIANTS.length];
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
    const style = VARIANT_STYLES[designVariant];
    const brand = input.brand ?? "MC Clinic Medical";
    const handle = input.handle ?? "@mc_clinic.du";
    const disclaimer = input.disclaimer ?? "Информация носит ознакомительный характер";

    const outputPath =
      input.outputPath ??
      path.resolve(process.cwd(), "tmp", "processed-media", `post-${Date.now()}-${randomUUID()}.jpg`);
    await ensureDir(path.dirname(outputPath));

    const chrome = buildChromeSvg({
      variant: designVariant,
      titleLines: [],
      titleFontSize: 48,
      brand,
      handle,
      disclaimer
    });
    const titleLayout = resolveTitleLayout({
      rawTitle: input.title,
      language: input.language,
      variant: designVariant,
      maxWidth: chrome.imageFrame.width - 88,
      maxHeight: style.topCardHeight - 60
    });
    const resolvedChrome = buildChromeSvg({
      variant: designVariant,
      titleLines: titleLayout.lines,
      titleFontSize: titleLayout.fontSize,
      brand,
      handle,
      disclaimer
    });

    const imageArea = resolvedChrome.imageFrame;
    const foregroundWidth = imageArea.width - 40;
    const foregroundHeight = imageArea.height - 40;

    const blurredBackgroundBase = await sharp(loaded.buffer)
      .rotate()
      .resize(imageArea.width, imageArea.height, { fit: "cover", position: "attention" })
      .blur(16)
      .modulate({ brightness: 0.9, saturation: 1 })
      .png()
      .toBuffer();
    const blurredBackground = await applyRoundedCorners(
      blurredBackgroundBase,
      imageArea.width,
      imageArea.height,
      28
    );

    const foregroundBase = await sharp(loaded.buffer)
      .rotate()
      .resize(foregroundWidth, foregroundHeight, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toBuffer();
    const foreground = await applyRoundedCorners(foregroundBase, foregroundWidth, foregroundHeight, 22);

    await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 3,
        background: "#f5f9fd"
      }
    })
      .composite([
        { input: buildBaseBackgroundSvg(designVariant), top: 0, left: 0 },
        { input: blurredBackground, top: imageArea.y, left: imageArea.x },
        { input: foreground, top: imageArea.y + 20, left: imageArea.x + 20 },
        { input: resolvedChrome.svg, top: 0, left: 0 }
      ])
      .jpeg({ quality: 93, mozjpeg: true })
      .toFile(outputPath);

    const outputStat = await fsPromises.stat(outputPath);
    const outputMeta = await sharp(outputPath).metadata();
    const centerVariance = await computePixelVariance({
      image: outputPath,
      region: {
        left: imageArea.x + Math.floor(imageArea.width * 0.2),
        top: imageArea.y + Math.floor(imageArea.height * 0.2),
        width: Math.floor(imageArea.width * 0.6),
        height: Math.floor(imageArea.height * 0.6)
      }
    });

    if (centerVariance < MIN_CENTER_VARIANCE) {
      throw new AppError("Media design failed: rendered image area appears blank", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: {
          centerVariance,
          threshold: MIN_CENTER_VARIANCE
        }
      });
    }

    this.serviceLogger.info("Media design completed", {
      designVariant,
      imageAreaMode: IMAGE_AREA_MODE,
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
      imageAreaMode: IMAGE_AREA_MODE,
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
      }
    };
  }
}

