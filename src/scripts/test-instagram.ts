import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

type InstagramEnv = {
  INSTAGRAM_GRAPH_API_BASE: string;
  INSTAGRAM_ACCESS_TOKEN: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID: string;
  FACEBOOK_PAGE_ID?: string;
  META_APP_SECRET?: string;
};

async function loadEnv(): Promise<InstagramEnv> {
  const envPath = path.resolve(process.cwd(), ".env");
  const raw = await fs.readFile(envPath, "utf-8");
  const parsed = dotenv.parse(raw);

  const required = ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"] as const;
  for (const key of required) {
    if (!parsed[key]?.trim()) {
      throw new Error(`Missing required env key for instagram test: ${key}`);
    }
  }

  return {
    INSTAGRAM_GRAPH_API_BASE: parsed.INSTAGRAM_GRAPH_API_BASE || "https://graph.facebook.com/v20.0",
    INSTAGRAM_ACCESS_TOKEN: parsed.INSTAGRAM_ACCESS_TOKEN,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: parsed.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    FACEBOOK_PAGE_ID: parsed.FACEBOOK_PAGE_ID,
    META_APP_SECRET: parsed.META_APP_SECRET
  };
}

function buildAppSecretProof(env: InstagramEnv): string | undefined {
  if (!env.META_APP_SECRET) {
    return undefined;
  }
  return createHmac("sha256", env.META_APP_SECRET).update(env.INSTAGRAM_ACCESS_TOKEN).digest("hex");
}

async function graphGet(env: InstagramEnv, endpoint: string): Promise<Record<string, unknown>> {
  const url = new URL(`${env.INSTAGRAM_GRAPH_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", env.INSTAGRAM_ACCESS_TOKEN);
  const proof = buildAppSecretProof(env);
  if (proof) {
    url.searchParams.set("appsecret_proof", proof);
  }
  const response = await fetch(url.toString());
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Graph API request failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const accountInfo = await graphGet(
    env,
    `/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=id,username`
  );
  const accountId = String(accountInfo.id ?? "");
  const username = String(accountInfo.username ?? "");
  if (!accountId) {
    throw new Error("Instagram account id is missing in Graph API response");
  }
  console.log(`Instagram account check OK: id=${accountId}, username=${username || "(empty)"}`);

  const accounts = await graphGet(env, "/me/accounts");
  const pages = Array.isArray(accounts.data) ? (accounts.data as Array<Record<string, unknown>>) : [];
  if (!pages.length) {
    throw new Error("No pages found in /me/accounts");
  }

  const pageIds = pages.map((page) => String(page.id ?? "")).filter(Boolean);
  if (env.FACEBOOK_PAGE_ID && !pageIds.includes(env.FACEBOOK_PAGE_ID)) {
    console.warn(
      `Warning: FACEBOOK_PAGE_ID mismatch. Configured=${env.FACEBOOK_PAGE_ID}. Available=${pageIds.join(", ")}`
    );
  } else if (env.FACEBOOK_PAGE_ID) {
    console.log(`Facebook page check OK: ${env.FACEBOOK_PAGE_ID}`);
  } else {
    console.log(`Facebook pages available: ${pageIds.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(`test:instagram failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
