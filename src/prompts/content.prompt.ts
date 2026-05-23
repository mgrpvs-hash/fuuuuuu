export function buildContentPrompt(input: {
  language: "ru" | "en";
  contentType: "post" | "reel" | "story";
  tone: string;
  description: string;
  hasVideo: boolean;
  hasImage: boolean;
  safetyNotes: string[];
}): string {
  const languageInstruction =
    input.language === "ru"
      ? "Пиши на русском языке."
      : "Write in English.";

  return `
You are a medical content strategist for a clinic Instagram account.
${languageInstruction}
Tone: ${input.tone}.
Content type: ${input.contentType}.
Media provided: image=${input.hasImage}, video=${input.hasVideo}.
User description: "${input.description}".

Safety requirements:
- Never provide diagnosis.
- Never promise treatment outcomes.
- Avoid absolute claims (e.g. 100% cure, guaranteed result, no risks).
- Keep language professional, neutral, and patient-friendly.
- If the content includes medical advice, add a clear informational disclaimer.
- If safety risks are detected, include a "risk_warning" value and safer alternative wording.
- Mention consulting a licensed physician where appropriate.
${input.safetyNotes.length ? `- Additional safety notes: ${input.safetyNotes.join("; ")}.` : ""}

Return STRICT JSON with the following schema:
{
  "captions": ["string", "string", "string"],
  "hashtags": ["#one", "#two"],
  "cta": "string",
  "story_text": "string",
  "reel_idea": "string or empty",
  "risk_warning": "string or empty",
  "safe_rewrite_hint": "string or empty"
}

Requirements:
- captions length: 2-3 options.
- hashtags length: 8-15.
- Keep each caption concise and suitable for Instagram.
- Do not use emojis excessively (0-3 max).
`.trim();
}
