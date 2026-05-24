import { env } from "../config/env.js";

async function main(): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: {
      id: number;
      username?: string;
      first_name?: string;
    };
  };

  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.description || `Telegram getMe failed (${response.status})`);
  }

  console.log("Telegram bot token check passed.");
  console.log(`Bot username: @${payload.result.username ?? "unknown"}`);
  console.log(`Bot id: ${payload.result.id}`);
}

main().catch((error) => {
  console.error(`test:telegram failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
