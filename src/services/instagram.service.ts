import { createHmac } from "node:crypto";
import path from "node:path";

import { env } from "../config/env.js";
import { ContentType, MediaType, PublishResult } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

interface GraphApiErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface GraphApiRawResponse {
  status: number;
  ok: boolean;
  payload: Record<string, unknown> & GraphApiErrorPayload;
}

const MAX_CAPTION_LENGTH = 2000;
const FLOW_VERSION = "unified-v2";

function isTransientHttpCode(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function shouldRetryError(error: unknown): boolean {
  return error instanceof AppError && error.code === "TRANSIENT_EXTERNAL_ERROR";
}

function classifyInstagramError(input: {
  message: string;
  statusCode: number;
  errorCode?: number;
}): string {
  const normalized = input.message.toLowerCase();
  if (normalized.includes("invalid oauth") || normalized.includes("access token")) {
    return "invalid token";
  }
  if (normalized.includes("permission") || normalized.includes("insufficient")) {
    return "missing permission";
  }
  if (normalized.includes("url") && (normalized.includes("not reachable") || normalized.includes("cannot"))) {
    return "media URL not accessible";
  }
  if (normalized.includes("unsupported") || normalized.includes("format")) {
    return "unsupported media type";
  }
  if (normalized.includes("container") && (normalized.includes("not ready") || normalized.includes("processing"))) {
    return "container not ready";
  }
  if (input.statusCode === 429 || input.statusCode >= 500) {
    return "Meta API transient error";
  }
  return "Meta API error";
}

function sanitizeRecord(data: Record<string, unknown>): Record<string, unknown> {
  const redactedKeys = new Set(["access_token", "token", "authorization", "appsecret_proof"]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (redactedKeys.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

function extractContainerId(payload: Record<string, unknown>): string | undefined {
  const p = payload as {
    id?: unknown;
    creation_id?: unknown;
    data?: { id?: unknown; creation_id?: unknown };
  };
  const value = p.id ?? p.data?.id ?? p.creation_id ?? p.data?.creation_id;
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function metaMessage(raw: GraphApiRawResponse): string {
  const errMsg = raw.payload.error?.message;
  if (errMsg && errMsg.trim()) {
    return errMsg;
  }
  return `Meta request failed with status ${raw.status}`;
}

export class InstagramService {
  private readonly serviceLogger = logger.child({ component: "instagram-service" });
  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly token: string;
  private readonly appSecretProof?: string;

  constructor() {
    this.baseUrl = env.INSTAGRAM_GRAPH_API_BASE;
    this.accountId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    this.token = env.INSTAGRAM_ACCESS_TOKEN;
    this.appSecretProof = env.META_APP_SECRET
      ? createHmac("sha256", env.META_APP_SECRET).update(this.token).digest("hex")
      : undefined;
  }

  private toPublicMediaUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    if (!env.MEDIA_PUBLIC_BASE_URL) {
      throw new AppError("MEDIA_PUBLIC_BASE_URL is not configured for local media URLs", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    const filename = path.basename(pathOrUrl);
    return `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/${filename}`;
  }

  private async callGraphApiRaw(options: {
    method: "GET" | "POST";
    endpoint: string;
    params?: Record<string, string>;
  }): Promise<GraphApiRawResponse> {
    const url = new URL(`${this.baseUrl}${options.endpoint}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.INSTAGRAM_REQUEST_TIMEOUT_MS);

    try {
      let response: Response;
      if (options.method === "GET") {
        url.searchParams.set("access_token", this.token);
        if (this.appSecretProof) {
          url.searchParams.set("appsecret_proof", this.appSecretProof);
        }
        response = await fetch(url.toString(), { method: "GET", signal: controller.signal });
      } else {
        const body = new URLSearchParams({
          ...(options.params ?? {}),
          access_token: this.token
        });
        if (this.appSecretProof) {
          body.set("appsecret_proof", this.appSecretProof);
        }
        response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: controller.signal
        });
      }
      const payload = (await response.json()) as Record<string, unknown> & GraphApiErrorPayload;
      return { status: response.status, ok: response.ok, payload };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Meta API transient error: timeout", {
          code: "TRANSIENT_EXTERNAL_ERROR",
          statusCode: 504,
          cause: error
        });
      }
      throw new AppError("Meta API transient error: network", {
        code: "TRANSIENT_EXTERNAL_ERROR",
        statusCode: 502,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async graphPostRaw(endpoint: string, params: Record<string, string>): Promise<GraphApiRawResponse> {
    return withRetry({
      attempts: env.INSTAGRAM_RETRY_ATTEMPTS,
      minDelayMs: env.INSTAGRAM_RETRY_MIN_DELAY_MS,
      maxDelayMs: env.INSTAGRAM_RETRY_MAX_DELAY_MS,
      operationName: `instagram-post:${endpoint}`,
      shouldRetry: shouldRetryError,
      operation: async () => {
        const raw = await this.callGraphApiRaw({ method: "POST", endpoint, params });
        if (!raw.ok && isTransientHttpCode(raw.status)) {
          throw new AppError("Meta API transient error", {
            code: "TRANSIENT_EXTERNAL_ERROR",
            statusCode: raw.status
          });
        }
        return raw;
      }
    });
  }

  private normalizeCaption(caption: string, hashtags: string[]): { value: string; warning?: string } {
    const combined = `${caption}\n\n${hashtags.join(" ")}`.trim();
    if (combined.length <= MAX_CAPTION_LENGTH) {
      return { value: combined };
    }
    const trimmed = combined.slice(0, MAX_CAPTION_LENGTH).trimEnd();
    return {
      value: trimmed,
      warning: `Caption was truncated to ${MAX_CAPTION_LENGTH} characters for safety.`
    };
  }

  private sanitizeContainerDebug(input: {
    raw: GraphApiRawResponse;
    requestPayload: Record<string, string>;
    contentType: ContentType;
  }): Record<string, unknown> {
    const err = input.raw.payload.error;
    return {
      flow_version: FLOW_VERSION,
      http_status: input.raw.status,
      error_type: err?.type ?? null,
      error_code: err?.code ?? null,
      error_subcode: err?.error_subcode ?? null,
      error_message: err?.message ?? null,
      fbtrace_id: err?.fbtrace_id ?? null,
      response_keys: Object.keys(input.raw.payload),
      response_sanitized: sanitizeRecord(input.raw.payload),
      request_payload: {
        image_url: input.requestPayload.image_url ?? null,
        caption_length: (input.requestPayload.caption ?? "").length,
        contentType: input.contentType
      }
    };
  }

  async validatePublicMediaUrl(mediaUrl: string, expectedMediaType: MediaType): Promise<void> {
    if (!mediaUrl.startsWith("https://")) {
      throw new AppError(
        "Media URL is not publicly accessible: status=invalid_url, content-type=unknown",
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }

    const request = async (method: "HEAD" | "GET"): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        return await fetch(mediaUrl, { method, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    };

    let response: Response;
    try {
      response = await request("HEAD");
      if (!response.ok || !response.headers.get("content-type")) {
        response = await request("GET");
      }
    } catch {
      throw new AppError("Media URL is not publicly accessible: status=network_error, content-type=unknown", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    const contentType = (response.headers.get("content-type") || "unknown").toLowerCase();
    if (!response.ok) {
      throw new AppError(
        `Media URL is not publicly accessible: status=${response.status}, content-type=${contentType}`,
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }

    if (expectedMediaType === "image" && !contentType.startsWith("image/")) {
      throw new AppError(
        `Media URL is not publicly accessible: status=${response.status}, content-type=${contentType}`,
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }
    if (expectedMediaType === "video" && !contentType.startsWith("video/")) {
      throw new AppError(
        `Media URL is not publicly accessible: status=${response.status}, content-type=${contentType}`,
        {
          code: "VALIDATION_ERROR",
          statusCode: 400
        }
      );
    }
  }

  async createInstagramMediaContainer(input: {
    igUserId?: string;
    imageUrl: string;
    caption: string;
    contentType: ContentType;
  }): Promise<{ containerId: string; rawResponseSanitized: Record<string, unknown> }> {
    const igUserId = input.igUserId ?? this.accountId;
    const payload = {
      image_url: input.imageUrl,
      caption: input.caption
    };
    const raw = await this.graphPostRaw(`/${igUserId}/media`, payload);
    const sanitized = this.sanitizeContainerDebug({
      raw,
      requestPayload: payload,
      contentType: input.contentType
    });

    if (!raw.ok) {
      this.serviceLogger.error("Instagram container creation failed", sanitized);
      throw new AppError(`Instagram container creation failed: ${metaMessage(raw)}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: raw.status,
        details: sanitized
      });
    }

    const containerId = extractContainerId(raw.payload);
    if (!containerId) {
      this.serviceLogger.error("Instagram container creation missing id", sanitized);
      throw new AppError("Instagram container creation failed: missing id in response", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: raw.status,
        details: sanitized
      });
    }

    return {
      containerId,
      rawResponseSanitized: sanitized
    };
  }

  async publishContainerById(containerId: string): Promise<{ igMediaId: string }> {
    const raw = await this.graphPostRaw(`/${this.accountId}/media_publish`, {
      creation_id: containerId
    });
    const err = raw.payload.error;
    const sanitized = {
      flow_version: FLOW_VERSION,
      http_status: raw.status,
      error_type: err?.type ?? null,
      error_code: err?.code ?? null,
      error_subcode: err?.error_subcode ?? null,
      error_message: err?.message ?? null,
      fbtrace_id: err?.fbtrace_id ?? null,
      response_keys: Object.keys(raw.payload),
      response_sanitized: sanitizeRecord(raw.payload)
    };

    if (!raw.ok) {
      throw new AppError(`Instagram publish failed: ${metaMessage(raw)}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: raw.status,
        details: sanitized
      });
    }

    const mediaId = extractContainerId(raw.payload);
    if (!mediaId) {
      throw new AppError("Instagram publish failed: missing id in response", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: raw.status,
        details: sanitized
      });
    }
    return { igMediaId: mediaId };
  }

  async publish(input: {
    contentType: ContentType;
    mediaType: MediaType;
    mediaPathOrUrl: string;
    caption: string;
    hashtags: string[];
  }): Promise<PublishResult> {
    try {
      if (input.contentType !== "post") {
        return {
          success: false,
          error: "Story/Reel publishing disabled for first MVP test. Please test Post first."
        };
      }
      if (input.mediaType !== "image") {
        return {
          success: false,
          error: "Story/Reel publishing disabled for first MVP test. Please test Post first."
        };
      }

      const imageUrl = this.toPublicMediaUrl(input.mediaPathOrUrl);
      await this.validatePublicMediaUrl(imageUrl, "image");
      const normalized = this.normalizeCaption(input.caption, input.hashtags);

      const created = await this.createInstagramMediaContainer({
        imageUrl,
        caption: normalized.value,
        contentType: input.contentType
      });
      const published = await this.publishContainerById(created.containerId);

      return {
        success: true,
        igContainerId: created.containerId,
        igMediaId: published.igMediaId,
        warning: normalized.warning
      };
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError("Meta API error", {
              code: "EXTERNAL_SERVICE_ERROR",
              statusCode: 500,
              cause: error
            });

      if (
        appError.message.startsWith("Instagram container creation failed:") ||
        appError.message.startsWith("Media URL is not publicly accessible:") ||
        appError.message.startsWith("Story/Reel publishing disabled for first MVP test.")
      ) {
        return { success: false, error: appError.message };
      }

      const errorCode = typeof appError.details?.errorCode === "number" ? appError.details.errorCode : undefined;
      const friendly = classifyInstagramError({
        message: appError.message,
        statusCode: appError.statusCode,
        errorCode
      });
      const summary = `${friendly}: ${appError.message}`;
      this.serviceLogger.error("Instagram publish failed", {
        code: appError.code,
        statusCode: appError.statusCode,
        errorCode,
        message: summary
      });
      return { success: false, error: summary };
    }
  }
}
