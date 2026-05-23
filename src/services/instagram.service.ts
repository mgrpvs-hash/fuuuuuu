import path from "node:path";

import { env } from "../config/env.js";
import { ContentType, PublishResult } from "../types/domain.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InstagramService {
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
      throw new Error(
        "MEDIA_PUBLIC_BASE_URL is not configured. Instagram Graph API needs publicly accessible media URLs."
      );
    }
    const filename = path.basename(localPath);
    return `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/${filename}`;
  }

  private async graphPost(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      ...params,
      access_token: this.token
    });

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Instagram API error: ${JSON.stringify(data)}`
      );
    }
    return data;
  }

  private async graphGet(endpoint: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this.baseUrl}${endpoint}${endpoint.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(this.token)}`
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`Instagram API error: ${JSON.stringify(data)}`);
    }
    return data;
  }

  private async publishContainer(containerId: string): Promise<{ id: string }> {
    const response = await this.graphPost(`/${this.accountId}/media_publish`, {
      creation_id: containerId
    });
    return { id: String(response.id) };
  }

  private async waitForContainerReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const statusData = await this.graphGet(`/${containerId}?fields=status_code,status`);
      const statusCode = String(statusData.status_code ?? "");
      if (statusCode === "FINISHED") {
        return;
      }
      if (statusCode === "ERROR") {
        throw new Error(`Instagram container processing failed: ${JSON.stringify(statusData)}`);
      }
      await sleep(3000);
    }
  }

  async publish(input: {
    contentType: ContentType;
    mediaPath: string;
    caption: string;
    storyText: string;
    hashtags: string[];
  }): Promise<PublishResult> {
    try {
      const mediaUrl = this.toPublicMediaUrl(input.mediaPath);
      const normalizedCaption = `${input.caption}\n\n${input.hashtags.join(" ")}`.trim();

      if (input.contentType === "post") {
        const create = await this.graphPost(`/${this.accountId}/media`, {
          image_url: mediaUrl,
          caption: normalizedCaption
        });
        const containerId = String(create.id);
        const publish = await this.publishContainer(containerId);
        return { success: true, igContainerId: containerId, igMediaId: publish.id };
      }

      if (input.contentType === "reel") {
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

      const create = await this.graphPost(`/${this.accountId}/media`, {
        media_type: "STORIES",
        image_url: mediaUrl
      });
      const containerId = String(create.id);
      const publish = await this.publishContainer(containerId);
      return {
        success: true,
        igContainerId: containerId,
        igMediaId: publish.id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown Instagram publishing error"
      };
    }
  }
}
