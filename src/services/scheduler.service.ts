import cron from "node-cron";
import dayjs from "dayjs";

import { AppDatabase } from "../db/database.js";
import { logger } from "../utils/logger.js";
import { ContentWorkflowService } from "./content-workflow.service.js";

export class SchedulerService {
  private task: cron.ScheduledTask | null = null;
  private isProcessing = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly workflowService: ContentWorkflowService,
    private readonly onResult?: (payload: { generatedContentId: number; success: boolean; message: string }) => Promise<void>
  ) {}

  start(): void {
    if (this.task) {
      return;
    }
    this.task = cron.schedule("*/1 * * * *", async () => {
      await this.processDuePosts();
    });
    logger.info("Scheduler started", { cron: "*/1 * * * *" });
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async processDuePosts(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const due = this.db.listDueSchedules(dayjs().toISOString());
      for (const item of due) {
        this.db.updateScheduleStatus(item.scheduleId, "running");
        const result = await this.workflowService.publishDraft(item.generatedContentId);
        this.db.updateScheduleStatus(item.scheduleId, result.success ? "published" : "failed");
        if (this.onResult) {
          await this.onResult({
            generatedContentId: item.generatedContentId,
            success: result.success,
            message: result.message
          });
        }
      }
    } catch (error) {
      logger.error("Failed processing scheduled posts", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.isProcessing = false;
    }
  }
}
