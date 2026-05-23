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
  if (!(error instanceof AppError)) {
    return false;
  }
  return error.code === "TRANSIENT_EXTERNAL_ERROR";
}

export class InstagramService {
  private readonly serviceLogger = logger.child({ component: "instagram-service" });
  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = env.INSTAGRAM_GRAPH_API_BASE;
    this.accountId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    this.token = env.INSTAGRAM_ACCESS_TOKEN;
  }

  private toPublicMediaUrl(localPath: string): string {
    if (!env.MEDIA_PUBLIC_BASE_URL) {
      throw new AppError(
        "MEDIA_PUBLIC_BASE_URL is not configured. Instagram Graph API needs publicly accessible media URLs.",
        { code: "VALIDATION_ERROR", statusCode: 400 }
      );
    }
    const filename = path.basename(localPath);
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
        response = await fetch(url.toString(), {
          method: "GET",
          signal: controller.signal
        });
      } else {
        const body = new URLSearchParams({
          ...(options.params ?? {}),
          access_token: this.token
        });
        response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: controller.signal
        });
      }

      const payload = (await response.json()) as Record<string, unknown> & GraphApiErrorPayload;
      if (!response.ok) {
        const apiError = payload.error;
        const message = apiError?.message ?? `Instagram API request failed (${response.status})`;
        throw new AppError(message, {
          code: isTransientHttpCode(response.status)
            ? "TRANSIENT_EXTERNAL_ERROR"
            : "EXTERNAL_SERVICE_ERROR",
          statusCode: response.status,
          details: {
            endpoint: options.endpoint,
            errorType: apiError?.type,
            errorCode: apiError?.code,
            errorSubcode: apiError?.error_subcode,
            traceId: apiError?.fbtrace_id
          }
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Instagram API request timeout", {
          code: "TRANSIENT_EXTERNAL_ERROR",
          statusCode: 504,
          cause: error
        });
      }
      throw new AppError("Instagram API network failure", {
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
    let terminalStatus = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const statusData = await this.graphGet(`/${containerId}?fields=status_code,status`);
      const statusCode = String(statusData.status_code ?? "");
      terminalStatus = statusCode;
      if (statusCode === "FINISHED") {
        return;
      }
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new AppError("Instagram container processing failed", {
          code: "EXTERNAL_SERVICE_ERROR",
          statusCode: 502,
          details: { containerId, statusData }
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    throw new AppError("Instagram container processing timeout", {
      code: "TRANSIENT_EXTERNAL_ERROR",
      statusCode: 504,
      details: { containerId, terminalStatus }
    });
  }

  async publish(input: {
    contentType: ContentType;
    mediaType: MediaType;
    mediaPath: string;
    caption: string;
    storyText: string;
    hashtags: string[];
  }): Promise<PublishResult> {
    try {
      const mediaUrl = this.toPublicMediaUrl(input.mediaPath);
      const normalizedCaption = `${input.caption}\n\n${input.hashtags.join(" ")}`.trim();

      if (input.contentType === "post") {
        if (input.mediaType !== "image") {
          throw new AppError("Post publishing currently supports image only", {
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
          throw new AppError("Reel publishing requires video media", {
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
          : new AppError("Unknown Instagram publishing error", {
              code: "EXTERNAL_SERVICE_ERROR",
              statusCode: 500,
              cause: error
            });

      this.serviceLogger.error("Instagram publish failed", {
        code: appError.code,
        statusCode: appError.statusCode,
        message: appError.message,
        details: appError.details
      });

      return {
        success: false,
        error: appError.message
      };
    }
  }
}
