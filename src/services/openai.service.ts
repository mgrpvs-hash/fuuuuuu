import OpenAI from "openai";

import { env } from "../config/env.js";
import { buildContentPrompt } from "../prompts/content.prompt.js";
import { GeneratedContentPayload } from "../types/domain.js";

function parseOutput(text: string): GeneratedContentPayload {
  const parsed = JSON.parse(text) as {
    captions?: string[];
    hashtags?: string[];
    cta?: string;
    story_text?: string;
    reel_idea?: string;
    risk_warning?: string;
    safe_rewrite_hint?: string;
  };

  if (!parsed.captions || parsed.captions.length < 2) {
    throw new Error("AI output missing captions");
  }
  if (!parsed.hashtags || parsed.hashtags.length === 0) {
    throw new Error("AI output missing hashtags");
  }

  return {
    captions: parsed.captions.slice(0, 3),
    hashtags: parsed.hashtags,
    cta: parsed.cta ?? "",
    storyText: parsed.story_text ?? "",
    reelIdea: parsed.reel_idea ?? "",
    riskWarning: parsed.risk_warning ?? "",
    safeRewriteHint: parsed.safe_rewrite_hint ?? ""
  };
}

export class OpenAiService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
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
    const prompt = buildContentPrompt(input);

    const completion = await this.client.responses.create({
      model: env.OPENAI_MODEL,
      input: prompt
    });

    const raw = completion.output_text?.trim();
    if (!raw) {
      throw new Error("OpenAI returned empty output");
    }

    return parseOutput(raw);
  }
}
