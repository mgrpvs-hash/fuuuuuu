import { AppDatabase } from "../db/database.js";
import { env } from "../config/env.js";
import { InstagramService } from "../services/instagram.service.js";
import { AppError } from "../types/errors.js";

function sanitize(data: unknown): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitize);
  }
  const redactedKeys = new Set([
    "access_token",
    "token",
    "authorization",
    "meta_app_secret",
    "instagram_access_token"
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (redactedKeys.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitize(value);
  }
  return out;
}

async function main(): Promise<void> {
  const publishFlag = (process.env.PUBLISH_TEST ?? "").toLowerCase() === "true";
  const db = await AppDatabase.init(env.DATABASE_URL);
  const media = db.getLatestMediaItemWithStorageUrl("image");

  if (!media || !media.storage_url) {
    console.log(
      "No media item with public storage_url found. Send a photo in Telegram first, then rerun npm run test:instagram-publish."
    );
    process.exit(1);
  }

  const instagram = new InstagramService();
  const caption =
    "MVP Instagram publish test for medical clinic content. Информация носит ознакомительный характер и не заменяет консультацию специалиста.";
  const hashtags = ["#mcclinic", "#healthcare", "#medical"];
  const captionWithHashtags = `${caption}\n\n${hashtags.join(" ")}`.trim();

  try {
    await instagram.validatePublicMediaUrl(media.storage_url, "image");
    console.log("Media URL validation: OK");
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("Media URL validation failed", { cause: error });
    console.log("Media URL validation failed:", {
      message: appError.message,
      details: sanitize(appError.details)
    });
    process.exit(1);
  }

  try {
    const create = await instagram.createInstagramMediaContainer({
      imageUrl: media.storage_url,
      contentType: "post",
      caption: captionWithHashtags
    });

    console.log("Create container response:", sanitize({
      containerId: create.containerId,
      rawResponseSanitized: create.rawResponseSanitized
    }));

    if (!publishFlag) {
      console.log("Publish step skipped. Set PUBLISH_TEST=true to run media_publish.");
      return;
    }

    const publish = await instagram.publishContainerById(create.containerId);
    console.log("Publish response:", sanitize(publish));
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("Instagram publish test failed", { cause: error });
    console.log("Instagram publish test failed:", sanitize({
      message: appError.message,
      code: appError.code,
      statusCode: appError.statusCode,
      details: appError.details
    }));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `test:instagram-publish failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
