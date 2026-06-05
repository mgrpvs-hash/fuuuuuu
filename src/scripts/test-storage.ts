import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

type StorageEnv = {
  MEDIA_STORAGE_PROVIDER: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
  SUPABASE_PUBLIC_FOLDER: string;
};

async function loadEnv(): Promise<StorageEnv> {
  const envPath = path.resolve(process.cwd(), ".env");
  const raw = await fs.readFile(envPath, "utf-8");
  const parsed = dotenv.parse(raw);

  const required = [
    "MEDIA_STORAGE_PROVIDER",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "SUPABASE_PUBLIC_FOLDER"
  ] as const;
  for (const key of required) {
    if (!parsed[key]?.trim()) {
      throw new Error(`Missing required env key for storage test: ${key}`);
    }
  }
  return parsed as StorageEnv;
}

async function fetchWithRetry(url: string, attempts: number): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Fetch retry failed");
}

async function main(): Promise<void> {
  const env = await loadEnv();
  if (env.MEDIA_STORAGE_PROVIDER !== "supabase") {
    throw new Error("MEDIA_STORAGE_PROVIDER must be supabase for test:storage");
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const fileName = `test-${randomUUID()}.txt`;
  const storagePath = `${env.SUPABASE_PUBLIC_FOLDER}/${yyyy}/${mm}/${fileName}`;

  const tmpPath = path.join(os.tmpdir(), `supabase-storage-test-${randomUUID()}.txt`);
  const content = `storage test ${new Date().toISOString()}\n`;
  await fs.writeFile(tmpPath, content, "utf-8");

  try {
    const upload = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, await fs.readFile(tmpPath), {
        upsert: false,
        contentType: "text/plain"
      });
    if (upload.error) {
      throw new Error(`Upload failed: ${upload.error.message}`);
    }

    const publicResult = supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = publicResult.data.publicUrl;
    if (!publicUrl) {
      throw new Error("Public URL was not returned");
    }

    const response = await fetchWithRetry(publicUrl, 5);
    const body = await response.text();
    if (!body.includes("storage test")) {
      throw new Error("Public file content check failed");
    }

    console.log("Supabase storage test passed.");
    console.log(`Uploaded path: ${storagePath}`);
    console.log("Public URL reachable: yes");

    const remove = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .remove([storagePath]);
    if (remove.error) {
      console.warn(`Warning: uploaded test file cleanup failed: ${remove.error.message}`);
    } else {
      console.log("Cleanup: uploaded test file removed.");
    }
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
}

main().catch((error) => {
  console.error(`test:storage failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
