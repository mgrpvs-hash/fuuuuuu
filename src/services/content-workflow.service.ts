import dayjs from "dayjs";

import { AppDatabase } from "../db/database.js";
import { DraftStatus } from "../types/domain.js";
import { InstagramService } from "./instagram.service.js";
import { SafetyService } from "./safety.service.js";

export class ContentWorkflowService {
  constructor(
    private readonly db: AppDatabase,
    private readonly safetyService: SafetyService,
    private readonly instagramService: InstagramService
  ) {}

  approveDraft(contentId: number, selectedCaption?: string): void {
    const draft = this.db.getGeneratedContentById(contentId);
    if (!draft) {
      throw new Error("Draft not found");
    }
    if (selectedCaption) {
      this.db.selectCaption(contentId, selectedCaption);
    }
    this.db.updateGeneratedStatus(contentId, "approved");
  }

  scheduleDraft(contentId: number, scheduledAt: string): number {
    const date = dayjs(scheduledAt);
    if (!date.isValid()) {
      throw new Error("Invalid schedule datetime");
    }
    if (date.isBefore(dayjs())) {
      throw new Error("Schedule time must be in the future");
    }
    return this.db.createSchedule(contentId, date.toISOString());
  }

  async publishDraftNow(contentId: number): Promise<{ success: boolean; message: string }> {
    return this.publishDraft(contentId);
  }

  async publishDraft(contentId: number): Promise<{ success: boolean; message: string }> {
    const draft = this.db.getGeneratedContentById(contentId);
    if (!draft) {
      return { success: false, message: "Draft not found" };
    }

    const media = this.db.getMediaItemById(draft.media_item_id);
    if (!media) {
      return { success: false, message: "Media not found for this draft" };
    }

    const captions = JSON.parse(draft.captions_json) as string[];
    const hashtags = JSON.parse(draft.hashtags_json) as string[];
    const baseCaption = draft.selected_caption ?? captions[0] ?? "";
    const withDisclaimer = this.safetyService.ensureMedicalDisclaimer(baseCaption, draft.language);
    const safetyCheck = this.safetyService.analyzeText(withDisclaimer);
    if (safetyCheck.hasUnsafeClaims) {
      this.db.markFailed(draft.id);
      this.db.createPublishLog({
        generatedContentId: draft.id,
        status: "failed",
        errorMessage: safetyCheck.warningMessage
      });
      return {
        success: false,
        message: `Safety check failed: ${safetyCheck.warningMessage}`
      };
    }

    const result = await this.instagramService.publish({
      contentType: draft.content_type,
      mediaPath: media.local_path,
      caption: withDisclaimer,
      storyText: draft.story_text,
      hashtags
    });

    if (!result.success) {
      this.db.markFailed(draft.id);
      this.db.createPublishLog({
        generatedContentId: draft.id,
        status: "failed",
        errorMessage: result.error
      });
      return { success: false, message: result.error ?? "Publish failed" };
    }

    this.db.markPublished(draft.id);
    this.db.createPublishLog({
      generatedContentId: draft.id,
      status: "published",
      igMediaId: result.igMediaId,
      igContainerId: result.igContainerId
    });
    return { success: true, message: "Published to Instagram successfully" };
  }

  markStatus(contentId: number, status: DraftStatus): void {
    this.db.updateGeneratedStatus(contentId, status);
  }
}
