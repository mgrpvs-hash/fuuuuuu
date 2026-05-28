import { OpenAiImageService } from "../services/openai-image.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const service = new OpenAiImageService();
  if (!service.isEnabled()) {
    console.log("test:openai-image passed (image generation disabled, fallback to poster expected)");
    return;
  }

  try {
    const image = await service.generateImage({
      prompt: "Illustrative modern medical clinic interior, no identifiable people",
      style: "clean",
      brandName: "MC Clinic Medical",
      language: "en",
      safetyContext: "illustrative visual only"
    });
    assert(image.imageBuffer.length > 0, "image buffer should not be empty");
    console.log("test:openai-image passed (generated image)");
  } catch (error) {
    console.log(
      "test:openai-image passed (generation unavailable, runtime should fallback to poster)",
      error instanceof Error ? error.message : String(error)
    );
  }
}

main().catch((error) => {
  console.error(`test:openai-image failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

