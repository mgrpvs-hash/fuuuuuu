import OpenAI from "openai";

import { env } from "../config/env.js";
import { brandConfig } from "../config/brand.js";
import { Language } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { logger } from "../utils/logger.js";

type GenerateImageInput = {
  prompt: string;
  style?: "clean" | "premium" | "minimal" | "educational" | "bold" | "medical";
  brandName: string;
  language: Language;
  safetyContext?: string;
};

type GenerateImageOutput = {
  imageBuffer: Buffer;
  imageUrl?: string;
  generationType: "ai_image";
  safetyLabelRequired: boolean;
};

function isSafetyLabelRequired(prompt: string): boolean {
  return /(реалистич|realistic|doctor|пациент|patient|команда|staff|clinic room|room)/i.test(prompt);
}

export class OpenAiImageService {
  private readonly client: OpenAI;
  private readonly serviceLogger = logger.child({ component: "openai-image-service" });

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_TIMEOUT_MS });
  }

  isEnabled(): boolean {
    return env.OPENAI_IMAGE_GENERATION_ENABLED;
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
    if (!this.isEnabled()) {
      throw new AppError("Image generation is disabled", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    const safePrompt = [
      input.prompt,
      `Style: ${input.style ?? "clean medical"}`,
      "Medical safety constraints:",
      "- no fake staff represented as real clinic team",
      "- no before/after manipulative claims",
      "- no explicit patient face focus unless provided by user",
      "- prefer illustrative, clean, trustworthy visual",
      `Brand context: ${input.brandName}, ${brandConfig.handle}`,
      input.safetyContext ? `Context: ${input.safetyContext}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const response = await this.client.images.generate({
        model: env.OPENAI_IMAGE_MODEL,
        prompt: safePrompt,
        size: "1024x1024"
      });

      const item = response.data?.[0];
      if (!item) {
        throw new Error("No image payload in OpenAI response");
      }

      let imageBuffer: Buffer | null = null;
      if ("b64_json" in item && item.b64_json) {
        imageBuffer = Buffer.from(item.b64_json, "base64");
      } else if ("url" in item && item.url) {
        const fetched = await fetch(item.url);
        if (!fetched.ok) {
          throw new Error(`OpenAI image URL fetch failed: ${fetched.status}`);
        }
        imageBuffer = Buffer.from(await fetched.arrayBuffer());
      }

      if (!imageBuffer) {
        throw new Error("OpenAI image output was empty");
      }

      return {
        imageBuffer,
        imageUrl: "url" in item ? item.url ?? undefined : undefined,
        generationType: "ai_image",
        safetyLabelRequired: isSafetyLabelRequired(input.prompt)
      };
    } catch (error) {
      this.serviceLogger.warn("OpenAI image generation failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new AppError("Failed to generate AI image", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: 502,
        cause: error
      });
    }
  }
}

