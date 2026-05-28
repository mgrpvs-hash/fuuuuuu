import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

const REQUIRED_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USER_IDS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "META_APP_ID",
  "META_APP_SECRET",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "FACEBOOK_PAGE_ID",
  "INSTAGRAM_USERNAME",
  "MEDIA_STORAGE_PROVIDER",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "SUPABASE_PUBLIC_FOLDER",
  "TELEGRAM_MODE"
] as const;

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("your_") ||
    normalized.includes("placeholder") ||
    normalized.includes("changeme") ||
    normalized.includes("example")
  );
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  try {
    await fs.access(envPath);
  } catch {
    throw new Error(".env file is missing in project root");
  }

  const raw = await fs.readFile(envPath, "utf-8");
  const parsed = dotenv.parse(raw);

  const errors: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const value = parsed[key];
    if (!value || !value.trim()) {
      errors.push(`Missing required key: ${key}`);
      continue;
    }
    if (looksLikePlaceholder(value)) {
      errors.push(`Key has placeholder-like value: ${key}`);
    }
  }

  if (!parsed.SUPABASE_URL || parsed.SUPABASE_URL.includes("/rest/v1/")) {
    errors.push("SUPABASE_URL must not include /rest/v1/");
  }
  if (parsed.TELEGRAM_MODE !== "polling") {
    errors.push("TELEGRAM_MODE must be polling for this run");
  }
  if (parsed.MEDIA_STORAGE_PROVIDER !== "supabase") {
    errors.push("MEDIA_STORAGE_PROVIDER must be supabase");
  }
  if (!parsed.TELEGRAM_ALLOWED_USER_IDS?.split(",").map((s) => s.trim()).includes("1400319960")) {
    errors.push("TELEGRAM_ALLOWED_USER_IDS must include 1400319960");
  }

  if (parsed.OPENAI_MODEL !== "gpt-4.1-mini") {
    errors.push("OPENAI_MODEL must be gpt-4.1-mini");
  }

  if (parsed.INSTAGRAM_BUSINESS_ACCOUNT_ID !== "17841432826668752") {
    errors.push("INSTAGRAM_BUSINESS_ACCOUNT_ID does not match expected value");
  }
  if (parsed.FACEBOOK_PAGE_ID !== "61590503815087") {
    errors.push("FACEBOOK_PAGE_ID does not match expected value");
  }
  if (parsed.SUPABASE_STORAGE_BUCKET !== "instagram-media") {
    errors.push("SUPABASE_STORAGE_BUCKET must be instagram-media");
  }
  if (parsed.SUPABASE_PUBLIC_FOLDER !== "mc-clinic-ai") {
    errors.push("SUPABASE_PUBLIC_FOLDER must be mc-clinic-ai");
  }

  if (errors.length) {
    console.error("Environment validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Environment validation passed.");
  console.log("Cloudinary variables are not required for this configuration.");
}

main().catch((error) => {
  console.error(`test:env failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
