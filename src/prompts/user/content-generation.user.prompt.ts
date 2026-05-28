import { ContentType, Language } from "../../types/domain.js";

export function buildContentGenerationUserPrompt(input: {
  language: Language;
  contentType: ContentType;
  tone: string;
  description: string;
  hasVideo: boolean;
  hasImage: boolean;
  safetyNotes: string[];
}): string {
  const languageInstruction =
    input.language === "ru" ? "Пиши только на русском языке." : "Write only in English.";

  return `
${languageInstruction}

Generate Instagram-ready content for a medical clinic profile.
Context:
- tone: ${input.tone}
- content type: ${input.contentType}
- media: image=${input.hasImage}, video=${input.hasVideo}
- user description: "${input.description}"
${input.safetyNotes.length ? `- safety alerts from precheck: ${input.safetyNotes.join("; ")}` : ""}

Output JSON object with keys:
{
  "captions": ["...", "...", "..."],
  "post_caption": "...",
  "visual_title": "...",
  "visual_subtitle": "...",
  "design_hint": "...",
  "bullet_points": ["...", "..."],
  "hashtags": ["#...", "#..."],
  "cta": "...",
  "story_text": "...",
  "reel_idea": "...",
  "risk_warning": "...",
  "safe_rewrite_hint": "..."
}

Rules:
- captions: 2-3 options, concise and medically careful;
- post_caption: one final post caption option for publishing;
- visual_title: short on-image headline, 42-52 chars max;
- visual_subtitle: optional short secondary line;
- design_hint: one of clean_light, premium_card, equipment_focus, announcement, educational, minimal_storylike, split_layout, full_bleed_blur;
- bullet_points: optional 2-3 short educational bullets only when relevant;
- hashtags: 8-15 tags, no spam;
- cta: soft and ethical (consultation / appointment / check-up), never manipulative;
- if content type is reel and video exists, provide concrete reel_idea;
- if no reel context, reel_idea can be an empty string;
- if risky claims are detected, set risk_warning and safe_rewrite_hint;
- avoid diagnosis and absolute claims.
`.trim();
}
