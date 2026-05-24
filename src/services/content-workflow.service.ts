import dayjs from "dayjs";

import { AppDatabase } from "../db/database.js";
import { DraftStatus } from "../types/domain.js";
import { AppError } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { InstagramService } from "./instagram.service.js";
import { MediaValidationService } from "./media-validation.service.js";
import { SafetyService } from "./safety.service.js";

export class ContentWorkflowService {
  private readonly workflowLogger = logger.child({ component: "content-workflow" });

  constructor(
    private readonly db: AppDatabase,
    private readonly safetyService: SafetyService,
    private readonly instagramService: InstagramService,
    private readonly mediaValidationService: MediaValidationService
  ) {}

  approveDraft(contentId: number, selectedCaption?: string): void {
    const draft = this.db.getGeneratedContentById(contentId);
    if (!draft) {
      throw new AppError("Draft not found", { code: "NOT_FOUND", statusCode: 404 });
    }
    if (selectedCaption) {
      this.db.selectCaption(contentId, selectedCaption);
    }
    this.db.updateGeneratedStatus(contentId, "approved");
  }

  scheduleDraft(contentId: number, scheduledAt: string): number {
    const date = dayjs(scheduledAt);
    if (!date.isValid()) {
      throw new AppError("Invalid schedule datetime", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
    }
    if (date.isBefore(dayjs())) {
      throw new AppError("Schedule time must be in the future", {
        code: "VALIDATION_ERROR",
        statusCode: 400
      });
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

    try {
      await this.mediaValidationService.validateStoredFile(media.local_path, media.media_type);

      const captions = JSON.parse(draft.captions_json) as string[];
      const hashtags = JSON.parse(draft.hashtags_json) as string[];
      const baseCaption = draft.selected_caption ?? captions[0] ?? "";
      const withDisclaimer = this.safetyService.ensureMedicalDisclaimer(baseCaption, draft.language);
      this.safetyService.assertSafeForPublishing(withDisclaimer);

      const mediaPathOrUrl = media.storage_url ?? media.local_path;
      const result = await this.instagramService.publish({
        contentType: draft.content_type,
        mediaType: media.media_type,
        mediaPathOrUrl,
        caption: withDisclaimer,
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

      this.workflowLogger.info("Draft published", {
        contentId: draft.id,
        igMediaId: result.igMediaId,
        igContainerId: result.igContainerId
      });
      return { success: true, message: "Published successfully" };
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError("Unexpected workflow publishing failure", {
              code: "INTERNAL_ERROR",
              cause: error
            });

      this.db.markFailed(draft.id);
      this.db.createPublishLog({
        generatedContentId: draft.id,
        status: "failed",
        errorMessage: appError.message
      });

      this.workflowLogger.error("Workflow publish failed", {
        contentId: draft.id,
        code: appError.code,
        message: appError.message
      });
      return { success: false, message: appError.message };
    }
  }

  markStatus(contentId: number, status: DraftStatus): void {
    this.db.updateGeneratedStatus(contentId, status);
  }
}
