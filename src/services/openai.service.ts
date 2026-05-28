import OpenAI from "openai";

import { env } from "../config/env.js";
import { contentGenerationSchema } from "../prompts/schemas/content-generation.schema.js";
import { draftEditGenerationSchema } from "../prompts/schemas/draft-edit-generation.schema.js";
import { draftInstructionClassificationSchema } from "../prompts/schemas/draft-instruction-classification.schema.js";
import { textPosterGenerationSchema } from "../prompts/schemas/text-poster-generation.schema.js";
import { DRAFT_EDIT_SYSTEM_PROMPT } from "../prompts/system/draft-edit.system.prompt.js";
import { MEDICAL_CONTENT_SYSTEM_PROMPT } from "../prompts/system/medical-content.system.prompt.js";
import { TEXT_POSTER_SYSTEM_PROMPT } from "../prompts/system/text-poster.system.prompt.js";
import { buildDraftEditUserPrompt } from "../prompts/user/draft-edit.user.prompt.js";
import { buildContentGenerationUserPrompt } from "../prompts/user/content-generation.user.prompt.js";
import { buildTextPosterUserPrompt } from "../prompts/user/text-poster.user.prompt.js";
import { GeneratedContentPayload, PosterGeneratedContentPayload } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { logger } from "../utils/logger.js";

function extractJsonPayload(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new AppError("OpenAI output does not contain valid JSON object", {
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502
    });
  }
  return text.slice(start, end + 1);
}

function parseOutput(text: string): GeneratedContentPayload {
  const jsonLike = extractJsonPayload(text);
  const parsedUnknown = JSON.parse(jsonLike) as unknown;
  const parsed = contentGenerationSchema.parse(parsedUnknown);

  return {
    captions: parsed.captions,
    postCaption: parsed.post_caption,
    visualTitle: parsed.visual_title,
    visualSubtitle: parsed.visual_subtitle,
    designHint: parsed.design_hint,
    bulletPoints: parsed.bullet_points,
    hashtags: parsed.hashtags,
    cta: parsed.cta,
    storyText: parsed.story_text,
    reelIdea: parsed.reel_idea,
    riskWarning: parsed.risk_warning,
    safeRewriteHint: parsed.safe_rewrite_hint
  };
}

function parsePosterOutput(text: string): PosterGeneratedContentPayload {
  const jsonLike = extractJsonPayload(text);
  const parsedUnknown = JSON.parse(jsonLike) as unknown;
  const parsed = textPosterGenerationSchema.parse(parsedUnknown);

  return {
    visualTitle: parsed.visual_title,
    visualSubtitle: parsed.visual_subtitle,
    shortOverlayText: parsed.short_overlay_text,
    posterCaption: parsed.poster_caption,
    cta: parsed.cta,
    hashtags: parsed.hashtags,
    posterType: parsed.poster_type,
    designHint: parsed.design_hint,
    safetyNotes: parsed.safety_notes
  };
}

export class OpenAiService {
  private readonly client: OpenAI;
  private readonly serviceLogger = logger.child({ component: "openai-service" });

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_TIMEOUT_MS });
  }

  async generateMedicalSafeContent(input: {
    language: "ru" | "en";
    contentType: "post" | "reel" | "story";
    tone: string;
    description: string;
    hasVideo: boolean;
    hasImage: boolean;
    safetyNotes: string[];
  }): Promise<GeneratedContentPayload> {
    const userPrompt = buildContentGenerationUserPrompt(input);

    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: MEDICAL_CONTENT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ]
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        throw new AppError("OpenAI returned empty output", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502
        });
      }

      return parseOutput(raw);
    } catch (error) {
      this.serviceLogger.error("OpenAI generation failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("Failed to generate content using OpenAI", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502,
        cause: error
      });
    }
  }

  async chatAssistant(input: {
    language: "ru" | "en";
    prompt: string;
    context?: string;
  }): Promise<string> {
    const system =
      input.language === "ru"
        ? "Ты AI-ассистент по контенту Instagram для медицинской клиники. Помогай с идеями, стилем и безопасным маркетинговым текстом. Не ставь диагноз и не назначай лечение."
        : "You are an AI assistant for a medical clinic Instagram content team. Help with ideas, style, and safe marketing copy. Never diagnose or prescribe treatment.";
    const user = [input.context ?? "", input.prompt].filter(Boolean).join("\n\n");
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      const text = response.output_text?.trim();
      if (!text) {
        throw new AppError("OpenAI returned empty output", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502
        });
      }
      return text;
    } catch (error) {
      this.serviceLogger.error("OpenAI assistant chat failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new AppError("Failed to generate assistant response", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502,
        cause: error
      });
    }
  }

  async generateIdeas(input: {
    language: "ru" | "en";
    count?: number;
  }): Promise<string> {
    const count = Math.min(15, Math.max(5, input.count ?? 10));
    const prompt =
      input.language === "ru"
        ? `Сгенерируй ${count} безопасных идей для Instagram медицинской клиники. Только контент-маркетинг, без диагнозов и обещаний лечения.`
        : `Generate ${count} safe Instagram content ideas for a medical clinic. Content marketing only, no diagnosis and no treatment promises.`;
    return this.chatAssistant({ language: input.language, prompt });
  }

  async generateWeeklyContentPlan(input: { language: "ru" | "en" }): Promise<string> {
    const prompt =
      input.language === "ru"
        ? "Составь контент-план на 7 дней для клиники: идеи для Post, Story и Reel, с мягким медицинским тоном и без рискованных обещаний."
        : "Create a 7-day clinic Instagram content plan with Post, Story, and Reel ideas in a soft compliant medical tone.";
    return this.chatAssistant({ language: input.language, prompt });
  }

  async generateTextPosterContent(input: {
    language: "ru" | "en";
    userPrompt: string;
  }): Promise<PosterGeneratedContentPayload> {
    const prompt = buildTextPosterUserPrompt(input);
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: TEXT_POSTER_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      });
      const raw = response.output_text?.trim();
      if (!raw) {
        throw new AppError("OpenAI returned empty output", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502
        });
      }
      return parsePosterOutput(raw);
    } catch (error) {
      this.serviceLogger.error("OpenAI text-poster generation failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("Failed to generate text poster content using OpenAI", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502,
        cause: error
      });
    }
  }

  async classifyDraftInstructionLLM(input: {
    userText: string;
    draftContext: string;
    language: "ru" | "en";
  }): Promise<{
    intent: string;
    confidence: number;
    params: Record<string, unknown>;
    userFacingSummary: string;
  } | null> {
    const userPrompt = `
${input.language === "ru" ? "Отвечай на русском." : "Reply in English."}

Classify the draft-edit instruction and return JSON:
{
  "intent": "...",
  "confidence": 0.0,
  "params": {...},
  "userFacingSummary": "..."
}

Allowed intents:
edit_caption, edit_design, edit_overlay_text, increase_overlay_text, decrease_overlay_text,
change_style, regenerate_design, regenerate_text, remove_hashtags, use_original, cancel,
schedule, approve_intent, create_carousel_suggestion, clarify

Draft context:
${input.draftContext}

User text:
"${input.userText}"
`.trim();

    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          {
            role: "system",
            content:
              "You classify Instagram draft edit commands for a medical clinic assistant. Return JSON only."
          },
          { role: "user", content: userPrompt }
        ]
      });
      const raw = response.output_text?.trim();
      if (!raw) return null;
      const parsed = draftInstructionClassificationSchema.parse(JSON.parse(extractJsonPayload(raw)));
      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        params: parsed.params as Record<string, unknown>,
        userFacingSummary: parsed.userFacingSummary
      };
    } catch (error) {
      this.serviceLogger.warn("Draft instruction LLM classifier failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async generateDraftEditContent(input: {
    language: "ru" | "en";
    instruction: string;
    draftContext: string;
  }): Promise<{
    visualTitle: string;
    visualSubtitle: string;
    overlayBullets: string[];
    finalCaption: string;
    hashtags: string[];
    cta: string;
    designHint: string;
    overlayDensity: "minimal" | "medium" | "detailed";
  }> {
    const prompt = buildDraftEditUserPrompt(input);
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: DRAFT_EDIT_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      });
      const raw = response.output_text?.trim();
      if (!raw) {
        throw new AppError("OpenAI returned empty draft edit output", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502
        });
      }
      const parsed = draftEditGenerationSchema.parse(JSON.parse(extractJsonPayload(raw)));
      return {
        visualTitle: parsed.visual_title,
        visualSubtitle: parsed.visual_subtitle,
        overlayBullets: parsed.overlay_bullets,
        finalCaption: parsed.final_caption,
        hashtags: parsed.hashtags,
        cta: parsed.cta,
        designHint: parsed.design_hint,
        overlayDensity: parsed.overlay_density
      };
    } catch (error) {
      this.serviceLogger.error("OpenAI draft edit generation failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new AppError("Failed to generate draft edit content using OpenAI", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502,
        cause: error
      });
    }
  }
}
