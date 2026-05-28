import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

type EnvConfig = {
  token: string;
  appSecret?: string;
  graphBase: string;
};

type GraphResult = {
  status: number;
  data: Record<string, unknown>;
};

type PageShape = {
  id?: string;
  name?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
  };
};

const CHECK_PAGE_IDS = [
  "1206870099170923",
  "61590000076672",
  "61590513924144"
] as const;

async function readEnvRaw(): Promise<Record<string, string>> {
  const envPath = path.resolve(process.cwd(), ".env");
  const raw = await fs.readFile(envPath, "utf-8");
  return dotenv.parse(raw);
}

function buildEnvConfig(parsed: Record<string, string>): EnvConfig {
  const token = parsed.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("INSTAGRAM_ACCESS_TOKEN missing");
  }
  return {
    token,
    appSecret: parsed.META_APP_SECRET?.trim() || undefined,
    graphBase: "https://graph.facebook.com/v25.0"
  };
}

function appSecretProof(token: string, appSecret?: string): string | undefined {
  if (!appSecret) {
    return undefined;
  }
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

async function graphGet(env: EnvConfig, endpoint: string): Promise<GraphResult> {
  const url = new URL(`${env.graphBase}/${endpoint}`);
  url.searchParams.set("access_token", env.token);
  const proof = appSecretProof(env.token, env.appSecret);
  if (proof) {
    url.searchParams.set("appsecret_proof", proof);
  }

  const response = await fetch(url.toString());
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

function printError(label: string, result: GraphResult): void {
  const err = (result.data.error ?? {}) as Record<string, unknown>;
  console.log(`${label} ERROR:`, {
    code: err.code ?? null,
    type: err.type ?? null,
    message: err.message ?? null,
    fbtrace_id: err.fbtrace_id ?? null
  });
}

function printPageRecord(label: string, page: PageShape): void {
  console.log(`${label}:`, {
    id: page.id ?? null,
    name: page.name ?? null,
    instagram_business_account_id: page.instagram_business_account?.id ?? null,
    instagram_business_account_username: page.instagram_business_account?.username ?? null
  });
}

async function updateEnvIds(input: {
  pageId: string;
  igBusinessId: string;
  igUsername: string;
}): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  const lines = (await fs.readFile(envPath, "utf-8")).split(/\r?\n/);

  const replacements = new Map<string, string>([
    ["FACEBOOK_PAGE_ID", input.pageId],
    ["INSTAGRAM_BUSINESS_ACCOUNT_ID", input.igBusinessId],
    ["INSTAGRAM_USERNAME", input.igUsername]
  ]);

  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const eq = line.indexOf("=");
    if (eq === -1) {
      return line;
    }
    const key = line.slice(0, eq).trim();
    if (!replacements.has(key)) {
      return line;
    }
    seen.add(key);
    return `${key}=${replacements.get(key)}`;
  });

  for (const [key, value] of replacements) {
    if (!seen.has(key)) {
      updated.push(`${key}=${value}`);
    }
  }

  await fs.writeFile(envPath, `${updated.join("\n").replace(/\n+$/, "")}\n`, "utf-8");
}

async function main(): Promise<void> {
  const parsed = await readEnvRaw();
  const env = buildEnvConfig(parsed);

  console.log("1) /me/accounts");
  const accounts = await graphGet(
    env,
    "me/accounts?fields=id,name,instagram_business_account{id,username}"
  );

  const candidatePages: PageShape[] = [];

  if ((accounts.data.error as unknown) !== undefined) {
    printError("/me/accounts", accounts);
  } else {
    const pages = Array.isArray(accounts.data.data)
      ? (accounts.data.data as PageShape[])
      : [];
    for (const page of pages) {
      printPageRecord("/me/accounts page", page);
      candidatePages.push(page);
    }
  }

  for (const id of CHECK_PAGE_IDS) {
    const result = await graphGet(
      env,
      `${id}?fields=id,name,instagram_business_account{id,username}`
    );
    if ((result.data.error as unknown) !== undefined) {
      printError(`/${id}`, result);
      continue;
    }
    const page = result.data as PageShape;
    printPageRecord(`/${id}`, page);
    candidatePages.push(page);
  }

  const withIg = candidatePages.find(
    (page) => page.id && page.instagram_business_account?.id && page.instagram_business_account?.username
  );

  if (withIg?.id && withIg.instagram_business_account?.id && withIg.instagram_business_account.username) {
    console.log("✅ USE THESE VALUES IN .env:");
    console.log(`FACEBOOK_PAGE_ID=${withIg.id}`);
    console.log(`INSTAGRAM_BUSINESS_ACCOUNT_ID=${withIg.instagram_business_account.id}`);
    console.log(`INSTAGRAM_USERNAME=${withIg.instagram_business_account.username}`);

    await updateEnvIds({
      pageId: withIg.id,
      igBusinessId: withIg.instagram_business_account.id,
      igUsername: withIg.instagram_business_account.username
    });
    console.log("✅ .env IDs updated");
    return;
  }

  console.log("❌ No accessible page with non-null instagram_business_account was found.");
  console.log("Bind Instagram account to the following page in Meta:");
  console.log("page_id=1206870099170923");
  console.log("page_name=MC Clinic Medical");
}

main().catch((error) => {
  console.error(
    `debug:instagram-access failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
