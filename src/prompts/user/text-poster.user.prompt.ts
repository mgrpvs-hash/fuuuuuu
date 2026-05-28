import { Language } from "../../types/domain.js";

export function buildTextPosterUserPrompt(input: {
  language: Language;
  userPrompt: string;
}): string {
  const languageInstruction =
    input.language === "ru" ? "Пиши только на русском языке." : "Write only in English.";

  return `
${languageInstruction}

Generate safe text-poster content for a medical clinic Instagram account.

User request:
"${input.userPrompt}"

Output JSON object with keys:
{
  "visual_title": "...",
  "visual_subtitle": "...",
  "short_overlay_text": "...",
  "poster_caption": "...",
  "cta": "...",
  "hashtags": ["#...", "#..."],
  "poster_type": "morning_health | medical_tip | clinic_announcement | minimalist_quote | service_card | educational_card",
  "design_hint": "...",
  "safety_notes": "..."
}

Rules:
- visual_title max 42 chars (RU) / 40 chars (EN)
- visual_subtitle max 70 chars
- short_overlay_text should be short (up to 12-16 words)
- poster_caption is for Instagram caption body, can be longer than overlay text
- keep medical language neutral and informational
- for vitamin requests do not suggest universal intake for everyone
- hashtags 8-12, no spam
`.trim();
}

