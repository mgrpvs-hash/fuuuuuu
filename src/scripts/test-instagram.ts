import { env } from "../config/env.js";

async function graphGet(endpoint: string): Promise<Record<string, unknown>> {
  const url = new URL(`${env.INSTAGRAM_GRAPH_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", env.INSTAGRAM_ACCESS_TOKEN);
  const response = await fetch(url.toString());
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Graph API request failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main(): Promise<void> {
  const accountInfo = await graphGet(`/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=id,username`);
  const accountId = String(accountInfo.id ?? "");
  const username = String(accountInfo.username ?? "");
  if (!accountId) {
    throw new Error("Instagram account id is missing in Graph API response");
  }
  console.log(`Instagram account check OK: id=${accountId}, username=${username || "(empty)"}`);

  const accounts = await graphGet("/me/accounts");
  const pages = Array.isArray(accounts.data) ? (accounts.data as Array<Record<string, unknown>>) : [];
  if (!pages.length) {
    throw new Error("No pages found in /me/accounts");
  }

  const pageIds = pages.map((page) => String(page.id ?? "")).filter(Boolean);
  const expectedPageId = env.FACEBOOK_PAGE_ID;
  if (expectedPageId && !pageIds.includes(expectedPageId)) {
    console.warn(`Warning: FACEBOOK_PAGE_ID mismatch. Configured=${expectedPageId}. Available=${pageIds.join(", ")}`);
  } else if (expectedPageId) {
    console.log(`Facebook page check OK: ${expectedPageId}`);
  } else {
    console.log(`Facebook pages available: ${pageIds.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(`test:instagram failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
