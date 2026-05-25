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

  private async callGraphApi(options: {
    method: "GET" | "POST";
    endpoint: string;
    params?: Record<string, string>;
  }): Promise<Record<string, unknown>> {
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
        response = await fetch(url.toString(), {
          method: "GET",
          signal: controller.signal
        });
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
      if (!response.ok) {
        const message = payload.error?.message ?? `Instagram API request failed (${response.status})`;
        throw new AppError(message, {
          code: isTransientHttpCode(response.status)
            ? "TRANSIENT_EXTERNAL_ERROR"
            : "EXTERNAL_SERVICE_ERROR",
          statusCode: response.status,
          details: {
            endpoint: options.endpoint,
            errorCode: payload.error?.code,
            errorSubcode: payload.error?.error_subcode,
            errorType: payload.error?.type,
            traceId: payload.error?.fbtrace_id
          }
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
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

  private async graphPost(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    return withRetry({
      attempts: env.INSTAGRAM_RETRY_ATTEMPTS,
      minDelayMs: env.INSTAGRAM_RETRY_MIN_DELAY_MS,
      maxDelayMs: env.INSTAGRAM_RETRY_MAX_DELAY_MS,
      operationName: `instagram-post:${endpoint}`,
      shouldRetry: shouldRetryError,
      operation: async () => this.callGraphApi({ method: "POST", endpoint, params })
    });
  }

  private async graphGet(endpoint: string): Promise<Record<string, unknown>> {
    return withRetry({
      attempts: env.INSTAGRAM_RETRY_ATTEMPTS,
      minDelayMs: env.INSTAGRAM_RETRY_MIN_DELAY_MS,
      maxDelayMs: env.INSTAGRAM_RETRY_MAX_DELAY_MS,
      operationName: `instagram-get:${endpoint}`,
      shouldRetry: shouldRetryError,
      operation: async () => this.callGraphApi({ method: "GET", endpoint })
    });
  }

  private async publishContainer(containerId: string): Promise<{ id: string }> {
    const response = await this.graphPost(`/${this.accountId}/media_publish`, {
      creation_id: containerId
    });
    return { id: String(response.id) };
  }

  private async waitForContainerReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const statusData = await this.graphGet(`/${containerId}?fields=status_code,status`);
      const statusCode = String(statusData.status_code ?? "");
      if (statusCode === "FINISHED") {
        return;
      }
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new AppError("container not ready", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502,
          details: { containerId, statusData }
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    throw new AppError("container not ready", {
      code: "TRANSIENT_EXTERNAL_ERROR",
      statusCode: 504,
      details: { containerId }
    });
  }

  async publish(input: {
    contentType: ContentType;
    mediaType: MediaType;
    mediaPathOrUrl: string;
    caption: string;
    hashtags: string[];
  }): Promise<PublishResult> {
    try {
      const mediaUrl = this.toPublicMediaUrl(input.mediaPathOrUrl);
      const normalizedCaption = `${input.caption}\n\n${input.hashtags.join(" ")}`.trim();

      if (input.contentType === "post") {
        if (input.mediaType !== "image") {
          throw new AppError("unsupported media type", {
            code: "VALIDATION_ERROR",
            statusCode: 400
          });
        }
        const create = await this.graphPost(`/${this.accountId}/media`, {
          image_url: mediaUrl,
          caption: normalizedCaption
        });
        const containerId = String(create.id);
        const publish = await this.publishContainer(containerId);
        return { success: true, igContainerId: containerId, igMediaId: publish.id };
      }

      if (input.contentType === "reel") {
        if (input.mediaType !== "video") {
          throw new AppError("unsupported media type", {
            code: "VALIDATION_ERROR",
            statusCode: 400
          });
        }
        const create = await this.graphPost(`/${this.accountId}/media`, {
          media_type: "REELS",
          video_url: mediaUrl,
          caption: normalizedCaption
        });
        const containerId = String(create.id);
        await this.waitForContainerReady(containerId);
        const publish = await this.publishContainer(containerId);
        return { success: true, igContainerId: containerId, igMediaId: publish.id };
      }

      const storyParams: Record<string, string> =
        input.mediaType === "video"
          ? { media_type: "STORIES", video_url: mediaUrl }
          : { media_type: "STORIES", image_url: mediaUrl };
      const create = await this.graphPost(`/${this.accountId}/media`, storyParams);
      const containerId = String(create.id);
      if (input.mediaType === "video") {
        await this.waitForContainerReady(containerId);
      }
      const publish = await this.publishContainer(containerId);
      return { success: true, igContainerId: containerId, igMediaId: publish.id };
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError("Meta API error", {
              code: "EXTERNAL_SERVICE_ERROR",
              statusCode: 500,
              cause: error
            });

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

      return {
        success: false,
        error: summary
      };
    }
  }
}
