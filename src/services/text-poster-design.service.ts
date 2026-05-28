import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

import { Language } from "../types/domain.js";
import { ensureDir } from "../utils/fs.js";

const WIDTH = 1080;
const HEIGHT = 1350;
const PADDING = 68;
const VERSION = "text-poster-v1";

export const TEXT_POSTER_STYLE_VARIANTS = [
  "morning_health",
  "medical_tip",
  "clinic_announcement",
  "minimalist_quote",
  "service_card",
  "educational_card"
] as const;

export type TextPosterStyleVariant = (typeof TEXT_POSTER_STYLE_VARIANTS)[number];

type PosterTheme = {
  bgStart: string;
  bgEnd: string;
  cardFill: string;
  cardStroke: string;
  title: string;
  subtitle: string;
  accent: string;
};

const THEMES: Record<TextPosterStyleVariant, PosterTheme> = {
  morning_health: {
    bgStart: "#f9f4e8",
    bgEnd: "#eef7ff",
    cardFill: "#ffffffdd",
    cardStroke: "#f0dcb5",
    title: "#17304a",
    subtitle: "#355f85",
    accent: "#f2b24f"
  },
  medical_tip: {
    bgStart: "#f3f9ff",
    bgEnd: "#e8f1fb",
    cardFill: "#ffffff",
    cardStroke: "#d5e3f2",
    title: "#17334e",
    subtitle: "#315f87",
    accent: "#4f88bb"
  },
  clinic_announcement: {
    bgStart: "#eef6ff",
    bgEnd: "#dfeefd",
    cardFill: "#ffffff",
    cardStroke: "#c6d9ef",
    title: "#12314d",
    subtitle: "#2d5f8e",
    accent: "#5b8fbd"
  },
  minimalist_quote: {
    bgStart: "#f7fbff",
    bgEnd: "#edf4fc",
    cardFill: "#ffffff",
    cardStroke: "#dde8f3",
    title: "#122c43",
    subtitle: "#56708c",
    accent: "#96b6d6"
  },
  service_card: {
    bgStart: "#f2f8ff",
    bgEnd: "#e5f1fb",
    cardFill: "#ffffff",
    cardStroke: "#cfe0f1",
    title: "#13324c",
    subtitle: "#305e84",
    accent: "#4a86b7"
  },
  educational_card: {
    bgStart: "#f5f9ff",
    bgEnd: "#e7f0fa",
    cardFill: "#ffffff",
    cardStroke: "#d3e1ef",
    title: "#14324b",
    subtitle: "#2f5f86",
    accent: "#4e87b6"
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

function estimateTextWidth(text: string, fontSize: number): number {
  return [...text].reduce((sum, char) => {
    if (char === " ") return sum + fontSize * 0.33;
    if (/[iljtI]/.test(char)) return sum + fontSize * 0.35;
    if (/[WMwm]/.test(char)) return sum + fontSize * 0.78;
    return sum + fontSize * 0.58;
  }, 0);
}

function fitEllipsis(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  let candidate = text.trim();
  while (candidate.length > 1 && estimateTextWidth(`${candidate}…`, fontSize) > maxWidth) {
    candidate = candidate.slice(0, -1).trimEnd();
  }
  return `${candidate}…`;
}

function wrap(text: string, width: number, fontSize: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words[0]) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = word;
    } else {
      lines.push(fitEllipsis(word, width, fontSize));
      line = "";
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = fitEllipsis(lines[maxLines - 1], width, fontSize);
  }
  return lines;
}

function chooseStyleVariant(input: {
  userPrompt: string;
  posterType?: string;
  styleVariant?: TextPosterStyleVariant;
}): TextPosterStyleVariant {
  if (input.styleVariant) return input.styleVariant;
  if (input.posterType && TEXT_POSTER_STYLE_VARIANTS.includes(input.posterType as TextPosterStyleVariant)) {
    return input.posterType as TextPosterStyleVariant;
  }
  const text = input.userPrompt.toLowerCase();
  if (/(доброе утро|утрен|витамин|morning)/i.test(text)) return "morning_health";
  if (/(анонс|новый|announcement|doctor|врач)/i.test(text)) return "clinic_announcement";
  if (/(цитата|quote|minimal|премиальн)/i.test(text)) return "minimalist_quote";
  if (/(услуг|service)/i.test(text)) return "service_card";
  if (/(образоват|инфограф|education)/i.test(text)) return "educational_card";
  return "medical_tip";
}

function sanitizeTitle(input: string, language: Language): string {
  const clean = input
    .replace(/100%|гарант|без риска|полностью вылеч|best method|guaranteed/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    return language === "en" ? "Care starts with attention" : "Забота начинается с внимания";
  }
  return clean.slice(0, language === "en" ? 42 : 52);
}

function sanitizeSubtitle(input: string, language: Language): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (!clean) {
    return language === "en"
      ? "Balanced routines support long-term wellbeing."
      : "Сбалансированные привычки помогают поддерживать самочувствие.";
  }
  return clean.slice(0, 70);
}

export class TextPosterDesignService {
  async createPoster(input: {
    userPrompt: string;
    language: Language;
    brandName: string;
    brandHandle: string;
    posterType?: string;
    styleVariant?: TextPosterStyleVariant;
    visualTitle: string;
    visualSubtitle?: string;
    shortOverlayText?: string;
    bulletPoints?: string[];
    overlayDensity?: "minimal" | "medium" | "detailed";
    outputPath?: string;
  }): Promise<{
    outputPath: string;
    width: number;
    height: number;
    variant: TextPosterStyleVariant;
    title: string;
    subtitle: string;
    disclaimer: string;
    designVersion: string;
    overlayDensity: "minimal" | "medium" | "detailed";
    bulletCount: number;
  }> {
    const variant = chooseStyleVariant({
      userPrompt: input.userPrompt,
      posterType: input.posterType,
      styleVariant: input.styleVariant
    });
    const theme = THEMES[variant];
    const title = sanitizeTitle(input.visualTitle, input.language);
    const subtitle = sanitizeSubtitle(input.visualSubtitle ?? input.shortOverlayText ?? "", input.language);
    const disclaimer =
      input.language === "en"
        ? "Educational information only."
        : "Информация носит ознакомительный характер.";

    const outputPath =
      input.outputPath ??
      path.resolve(process.cwd(), "tmp", "generated-posters", `poster-${Date.now()}-${randomUUID()}.jpg`);
    await ensureDir(path.dirname(outputPath));

    const titleSize = variant === "minimalist_quote" ? 64 : 54;
    const subtitleSize = 32;
    const bulletSize = 28;
    const contentWidth = WIDTH - PADDING * 2;
    const titleLines = wrap(title, contentWidth, titleSize, 2);
    const subtitleLines = wrap(subtitle, contentWidth, subtitleSize, 2);

    const overlayDensity = input.overlayDensity ?? (variant === "educational_card" ? "detailed" : "medium");
    const rawBulletCandidates =
      input.bulletPoints && input.bulletPoints.length
        ? input.bulletPoints
        : wrap((input.shortOverlayText ?? subtitle).replace(/\.$/, ""), contentWidth - 90, bulletSize, 3);
    const bulletSource = rawBulletCandidates
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((line) => {
        const limit = input.language === "en" ? 50 : 55;
        return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
      });

    const titleLineHeight = Math.round(titleSize * 1.12);
    const subtitleLineHeight = Math.round(subtitleSize * 1.2);
    const subtitleLinesToRender = overlayDensity === "minimal" ? [] : subtitleLines;
    const titleStartY = PADDING + 150;
    const subtitleStartY = titleStartY + titleLines.length * titleLineHeight + 26;
    const bulletStartY = subtitleStartY + subtitleLinesToRender.length * subtitleLineHeight + 40;
    const brandY = HEIGHT - PADDING - 84;
    const maxBulletBySpace = Math.max(0, Math.min(3, Math.floor((brandY - 24 - bulletStartY) / 42)));
    const bulletLinesToRender = bulletSource.slice(0, maxBulletBySpace);

    const bulletSvg =
      overlayDensity === "detailed" &&
      (variant === "morning_health" || variant === "medical_tip" || variant === "educational_card" || variant === "service_card")
        ? bulletLinesToRender
            .map(
              (line, index) =>
                `<text x="${PADDING + 22}" y="${bulletStartY + index * 42}" font-size="${bulletSize}" font-family="Arial, Helvetica, sans-serif" fill="${theme.subtitle}">• ${escapeXml(line)}</text>`
            )
            .join("")
        : "";

    const iconSvg =
      variant === "morning_health"
        ? `<g>
             <circle cx="${WIDTH - 146}" cy="${132}" r="36" fill="${theme.accent}"/>
             <circle cx="${WIDTH - 218}" cy="${196}" r="20" fill="#9ec4df"/>
             <circle cx="${WIDTH - 98}" cy="${220}" r="16" fill="#b4d899"/>
             <rect x="${WIDTH - 178}" y="236" width="22" height="44" rx="8" fill="#f3c77d"/>
           </g>`
        : "";

    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${theme.bgStart}" />
            <stop offset="100%" stop-color="${theme.bgEnd}" />
          </linearGradient>
        </defs>
        <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
        <rect x="${PADDING}" y="${PADDING}" width="${contentWidth}" height="${HEIGHT - PADDING * 2}" rx="36" fill="${theme.cardFill}" stroke="${theme.cardStroke}" stroke-width="2" />
        ${iconSvg}
        ${titleLines
          .map(
            (line, index) =>
              `<text x="${PADDING + 20}" y="${titleStartY + index * titleLineHeight}" font-size="${titleSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${theme.title}">${escapeXml(line)}</text>`
          )
          .join("")}
        ${subtitleLinesToRender
          .map(
            (line, index) =>
              `<text x="${PADDING + 20}" y="${subtitleStartY + index * subtitleLineHeight}" font-size="${subtitleSize}" font-family="Arial, Helvetica, sans-serif" font-weight="500" fill="${theme.subtitle}">${escapeXml(line)}</text>`
          )
          .join("")}
        ${bulletSvg}
        <text x="${PADDING + 20}" y="${brandY}" font-size="36" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="${theme.title}">${escapeXml(input.brandName)}</text>
        <text x="${PADDING + 20}" y="${brandY + 36}" font-size="30" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="${theme.subtitle}">${escapeXml(input.brandHandle)}</text>
        <text x="${PADDING + 20}" y="${brandY + 70}" font-size="24" font-family="Arial, Helvetica, sans-serif" fill="${theme.subtitle}">${escapeXml(disclaimer)}</text>
      </svg>
    `;

    await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT)
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(outputPath);

    return {
      outputPath,
      width: WIDTH,
      height: HEIGHT,
      variant,
      title,
      subtitle,
      disclaimer,
      designVersion: `${VERSION}/${variant}`,
      overlayDensity,
      bulletCount: overlayDensity === "detailed" ? bulletLinesToRender.length : 0
    };
  }
}

