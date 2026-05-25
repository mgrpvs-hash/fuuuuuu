import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

async function loadToken(): Promise<string> {
  const envPath = path.resolve(process.cwd(), ".env");
  const raw = await fs.readFile(envPath, "utf-8");
  const parsed = dotenv.parse(raw);
  const token = parsed.TELEGRAM_BOT_TOKEN;
  if (!token?.trim()) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
  }
  return token;
}

async function main(): Promise<void> {
  const token = await loadToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: {
      id: number;
      username?: string;
    };
  };

  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.description || `Telegram getMe failed (${response.status})`);
  }

  console.log("Telegram OK");
  console.log(`bot username: @${payload.result.username ?? "unknown"}`);
  console.log(`bot id: ${payload.result.id}`);
}

main().catch((error) => {
  console.error(`test:telegram failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
