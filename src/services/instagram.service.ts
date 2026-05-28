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

function safeMetaError(raw: GraphApiRawResponse): Record<string, unknown> {
  const err = raw.payload.error;
  return {
    status: raw.status,
    error_type: err?.type ?? null,
    error_code: err?.code ?? null,
    error_subcode: err?.error_subcode ?? null,
    error_message: err?.message ?? null,
    fbtrace_id: err?.fbtrace_id ?? null
  };
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
            statusCode: raw.status,
            details: safeMetaError(raw)
          });
        }
        return raw;
      }
    });
  }

  private async graphGetRaw(endpoint: string): Promise<GraphApiRawResponse> {
    return withRetry({
      attempts: env.INSTAGRAM_RETRY_ATTEMPTS,
      minDelayMs: env.INSTAGRAM_RETRY_MIN_DELAY_MS,
      maxDelayMs: env.INSTAGRAM_RETRY_MAX_DELAY_MS,
      operationName: `instagram-get:${endpoint}`,
      shouldRetry: shouldRetryError,
      operation: async () => {
        const raw = await this.callGraphApiRaw({ method: "GET", endpoint });
        if (!raw.ok && isTransientHttpCode(raw.status)) {
          throw new AppError("Meta API transient error", {
            code: "TRANSIENT_EXTERNAL_ERROR",
            statusCode: raw.status,
            details: safeMetaError(raw)
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

  async validatePublicMediaUrl(mediaUrl: string, expectedMediaType: MediaType): Promise<void> {
    if (!mediaUrl.startsWith("https://")) {
      throw new AppError("Media URL is not publicly accessible", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { reason: "URL must start with https://", mediaUrl }
      });
    }

    const doRequest = async (method: "HEAD" | "GET"): Promise<Response> => {
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
      response = await doRequest("HEAD");
      if (!response.ok || !response.headers.get("content-type")) {
        response = await doRequest("GET");
      }
    } catch {
      throw new AppError("Media URL is not publicly accessible", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !contentType) {
      throw new AppError("Media URL is not publicly accessible", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { status: response.status, contentType: contentType || null }
      });
    }

    if (expectedMediaType === "image" && !contentType.startsWith("image/")) {
      throw new AppError("Media URL is not publicly accessible", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { status: response.status, contentType }
      });
    }
    if (expectedMediaType === "video" && !contentType.startsWith("video/")) {
      throw new AppError("Media URL is not publicly accessible", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: { status: response.status, contentType }
      });
    }
  }

  async createPostContainer(input: {
    mediaPathOrUrl: string;
    mediaType: MediaType;
    contentType: ContentType;
    caption: string;
    hashtags: string[];
  }): Promise<{ containerId: string; mediaUrl: string; warning?: string }> {
    if (input.contentType !== "post") {
      throw new AppError("Story/Reel publishing disabled for first MVP test. Please test Post first.", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    if (input.mediaType !== "image") {
      throw new AppError("unsupported media type", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }

    const mediaUrl = this.toPublicMediaUrl(input.mediaPathOrUrl);
    await this.validatePublicMediaUrl(mediaUrl, "image");

    const normalized = this.normalizeCaption(input.caption, input.hashtags);
    const requestPayload = {
      image_url: mediaUrl,
      caption: normalized.value
    };

    const createRaw = await this.graphPostRaw(`/${this.accountId}/media`, requestPayload);
    if (!createRaw.ok) {
      const message =
        createRaw.payload.error?.message ?? `Meta request failed with status ${createRaw.status}`;
      this.serviceLogger.error("Instagram container creation failed", {
        ...safeMetaError(createRaw),
        request_payload: {
          image_url: mediaUrl,
          caption_length: normalized.value.length,
          contentType: input.contentType
        }
      });
      throw new AppError(`Instagram container creation failed: ${message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: createRaw.status,
        details: {
          ...safeMetaError(createRaw),
          request_payload: {
            image_url: mediaUrl,
            caption_length: normalized.value.length,
            contentType: input.contentType
          }
        }
      });
    }

    const id = createRaw.payload.id;
    if (!id) {
      const message = createRaw.payload.error?.message ?? "Media ID is not available";
      const meta = safeMetaError(createRaw);
      this.serviceLogger.error("Instagram container creation missing id", {
        ...meta,
        request_payload: {
          image_url: mediaUrl,
          caption_length: normalized.value.length,
          contentType: input.contentType
        }
      });
      throw new AppError(`Instagram container creation failed: ${message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: createRaw.status,
        details: {
          ...meta,
          request_payload: {
            image_url: mediaUrl,
            caption_length: normalized.value.length,
            contentType: input.contentType
          }
        }
      });
    }

    return { containerId: String(id), mediaUrl, warning: normalized.warning };
  }

  async publishContainerById(containerId: string): Promise<{ igMediaId: string }> {
    const publishRaw = await this.graphPostRaw(`/${this.accountId}/media_publish`, {
      creation_id: containerId
    });
    if (!publishRaw.ok) {
      const message =
        publishRaw.payload.error?.message ?? `Meta request failed with status ${publishRaw.status}`;
      throw new AppError(`Instagram publish failed: ${message}`, {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: publishRaw.status,
        details: safeMetaError(publishRaw)
      });
    }
    const id = publishRaw.payload.id;
    if (!id) {
      throw new AppError("Instagram publish failed: Media ID is not available", {
        code: "EXTERNAL_SERVICE_ERROR",
        statusCode: publishRaw.status,
        details: {
          status: publishRaw.status,
          response_payload: publishRaw.payload
        }
      });
    }
    return { igMediaId: String(id) };
  }

  async publish(input: {
    contentType: ContentType;
    mediaType: MediaType;
    mediaPathOrUrl: string;
    caption: string;
    hashtags: string[];
  }): Promise<PublishResult> {
    try {
      const create = await this.createPostContainer({
        mediaPathOrUrl: input.mediaPathOrUrl,
        mediaType: input.mediaType,
        contentType: input.contentType,
        caption: input.caption,
        hashtags: input.hashtags
      });

      const publish = await this.publishContainerById(create.containerId);
      return {
        success: true,
        igContainerId: create.containerId,
        igMediaId: publish.igMediaId,
        warning: create.warning
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

      const explicitMessage = appError.message;
      if (
        explicitMessage.startsWith("Instagram container creation failed:") ||
        explicitMessage === "Media URL is not publicly accessible" ||
        explicitMessage.startsWith("Story/Reel publishing disabled for first MVP test.")
      ) {
        return { success: false, error: explicitMessage };
      }

      const errorCode = typeof appError.details?.errorCode === "number" ? appError.details.errorCode : undefined;
      const friendly = classifyInstagramError({
        message: explicitMessage,
        statusCode: appError.statusCode,
        errorCode
      });
      const summary = `${friendly}: ${explicitMessage}`;

      this.serviceLogger.error("Instagram publish failed", {
        code: appError.code,
        statusCode: appError.statusCode,
        errorCode,
        message: summary
      });

      return {
        success: false,
        error: summary
      };
    }
  }
}
