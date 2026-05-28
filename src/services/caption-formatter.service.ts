import { ContentType } from "../types/domain.js";

const DEFAULT_MAX_INSTAGRAM_CAPTION_LENGTH = 2200;
const MAX_HASHTAGS = 12;
const MIN_HASHTAGS = 8;

const RISKY_CLAIM_PATTERNS = [
  /100%\s*результат/gi,
  /гарант\w*/gi,
  /без\s*риска/gi,
  /полностью\s*вылеч\w*/gi,
  /best\s*treatment/gi,
  /risk[-\s]?free/gi,
  /guaranteed/gi
];

const BANNED_LABEL_PATTERNS = [/^option\s*\d+\s*[:\-]\s*/i, /^\d+\.\s*/];

export type CaptionFormatResult = {
  caption: string;
  wasTrimmed: boolean;
  warning?: string;
  hashtags: string[];
};

function cleanupCaptionLine(value: string): string {
  const stripped = BANNED_LABEL_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ""), value);
  let safe = stripped
    .replace(/story[_\s]?text/gi, "")
    .replace(/caption options?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of RISKY_CLAIM_PATTERNS) {
    safe = safe.replace(pattern, "");
  }
  return safe.replace(/\s+/g, " ").trim();
}

function cleanupHashtag(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_#]/gu, "");
  if (!normalized) return "";
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized.replace(/^#+/, "")}`;
  if (withHash === "#" || withHash.length < 3 || withHash.length > 40) {
    return "";
  }
  return withHash;
}

function uniqueHashtags(hashtags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hashtag of hashtags) {
    const key = hashtag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hashtag);
  }
  return out;
}

function trimBodyPreservingWords(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${safe.trimEnd()}…`;
}

function ensureDisclaimerForMedicalContext(text: string): string {
  const medicalContext = /(лечен|терап|диагност|препарат|treatment|therapy|diagnostic|medication)/i.test(text);
  if (!medicalContext) return text;
  if (/ознакомительный характер|educational purposes only/i.test(text)) return text;
  return `${text}\n\nИнформация носит ознакомительный характер и не заменяет консультацию специалиста.`;
}

function pickHashtags(raw: string[] | null | undefined): string[] {
  const cleaned = uniqueHashtags((raw ?? []).map(cleanupHashtag).filter(Boolean));
  const selected = cleaned.slice(0, MAX_HASHTAGS);
  if (selected.length >= MIN_HASHTAGS) {
    return selected;
  }
  const defaults = [
    "#mcclinic",
    "#medicalcare",
    "#healthcare",
    "#cliniclife",
    "#patientcare",
    "#wellness",
    "#diagnostics",
    "#healthtips"
  ];
  const merged = uniqueHashtags([...selected, ...defaults]);
  return merged.slice(0, Math.max(MIN_HASHTAGS, selected.length));
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
  const hashtags = pickHashtags(input.hashtags);
  const hashtagsBlock = hashtags.join(" ").trim();

  const bodyBlocks = [selectedCaption, cta].filter(Boolean);
  let body = bodyBlocks.join("\n\n").trim();
  body = ensureDisclaimerForMedicalContext(body);

  if (input.contentType !== "post") {
    return {
      caption: [body, hashtagsBlock].filter(Boolean).join("\n\n").trim(),
      wasTrimmed: false,
      hashtags
    };
  }

  const fullCaption = [body, hashtagsBlock].filter(Boolean).join("\n\n").trim();
  if (fullCaption.length <= captionMax) {
    return { caption: fullCaption, wasTrimmed: false, hashtags };
  }

  const hashtagsFootprint = hashtagsBlock ? hashtagsBlock.length + 2 : 0;
  const reservedForBody = Math.max(0, captionMax - hashtagsFootprint);
  const shortenedBody = trimBodyPreservingWords(body, reservedForBody);
  const shortened = [shortenedBody, hashtagsBlock].filter(Boolean).join("\n\n").slice(0, captionMax).trim();

  return {
    caption: shortened,
    wasTrimmed: true,
    warning: "Caption был сокращён для Instagram.",
    hashtags
  };
}

