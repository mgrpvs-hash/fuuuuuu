import OpenAI from "openai";

import { env } from "../config/env.js";
import { contentGenerationSchema } from "../prompts/schemas/content-generation.schema.js";
import { MEDICAL_CONTENT_SYSTEM_PROMPT } from "../prompts/system/medical-content.system.prompt.js";
import { buildContentGenerationUserPrompt } from "../prompts/user/content-generation.user.prompt.js";
import { GeneratedContentPayload } from "../types/domain.js";
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
    hashtags: parsed.hashtags,
    cta: parsed.cta,
    storyText: parsed.story_text,
    reelIdea: parsed.reel_idea,
    riskWarning: parsed.risk_warning,
    safeRewriteHint: parsed.safe_rewrite_hint
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
}
