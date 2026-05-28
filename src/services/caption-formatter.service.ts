import { ContentType } from "../types/domain.js";

const DEFAULT_MAX_INSTAGRAM_CAPTION_LENGTH = 2200;

export type CaptionFormatResult = {
  caption: string;
  wasTrimmed: boolean;
  warning?: string;
};

function cleanupCaptionLine(value: string): string {
  return value
    .replace(/^option\s*\d+\s*[:\-]\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function cleanupHashtag(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.startsWith("#") ? normalized : `#${normalized.replace(/^#+/, "")}`;
}

function trimBodyPreservingWords(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const sliced = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${safe.trimEnd()}…`;
}

export function formatInstagramCaption(input: {
  selectedCaption?: string | null;
  cta?: string | null;
  hashtags?: string[] | null;
  contentType: ContentType;
  maxLength?: number;
}): CaptionFormatResult {
  const captionMax = input.maxLength ?? DEFAULT_MAX_INSTAGRAM_CAPTION_LENGTH;
  const selectedCaption = cleanupCaptionLine(String(input.selectedCaption ?? ""));
  const cta = cleanupCaptionLine(String(input.cta ?? ""));
  const hashtags = (input.hashtags ?? []).map(cleanupHashtag).filter(Boolean);

  const bodyBlocks = [selectedCaption, cta].filter(Boolean);
  const body = bodyBlocks.join("\n\n").trim();
  const hashtagsBlock = hashtags.join(" ").trim();

  if (input.contentType !== "post") {
    const nonPostCaption = [body, hashtagsBlock].filter(Boolean).join("\n\n").trim();
    return { caption: nonPostCaption, wasTrimmed: false };
  }

  const fullCaption = [body, hashtagsBlock].filter(Boolean).join("\n\n").trim();
  if (fullCaption.length <= captionMax) {
    return { caption: fullCaption, wasTrimmed: false };
  }

  const hashtagsFootprint = hashtagsBlock ? hashtagsBlock.length + 2 : 0;
  const reservedForBody = Math.max(0, captionMax - hashtagsFootprint);
  const shortenedBody = trimBodyPreservingWords(body, reservedForBody);
  const shortened = [shortenedBody, hashtagsBlock].filter(Boolean).join("\n\n").slice(0, captionMax).trim();

  return {
    caption: shortened,
    wasTrimmed: true,
    warning: "Caption был сокращён для Instagram."
  };
}

