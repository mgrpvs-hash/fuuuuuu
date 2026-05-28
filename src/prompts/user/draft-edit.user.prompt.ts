import { Language } from "../../types/domain.js";

export function buildDraftEditUserPrompt(input: {
  language: Language;
  instruction: string;
  draftContext: string;
}): string {
  const langInstruction =
    input.language === "ru" ? "Пиши на русском языке." : "Write in English.";

  return `
${langInstruction}

Current draft context:
${input.draftContext}

User instruction:
"${input.instruction}"

Return JSON:
{
  "visual_title": "...",
  "visual_subtitle": "...",
  "overlay_bullets": ["...", "..."],
  "final_caption": "...",
  "hashtags": ["#...", "#..."],
  "cta": "...",
  "design_hint": "...",
  "overlay_density": "minimal | medium | detailed"
}

Rules:
- overlay_bullets max 3
- each bullet short and readable
- keep language unless user requested to change
- if instruction asks more text on image -> overlay_density should be detailed
- if instruction asks less text on image -> overlay_density minimal
`.trim();
}

