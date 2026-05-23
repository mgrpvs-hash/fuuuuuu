import cron from "node-cron";
import dayjs from "dayjs";

import { AppDatabase } from "../db/database.js";
import { logger } from "../utils/logger.js";
import { ContentWorkflowService } from "./content-workflow.service.js";

export class SchedulerService {
  private task: cron.ScheduledTask | null = null;
  private isProcessing = false;
  private readonly serviceLogger = logger.child({ component: "scheduler-service" });

  constructor(
    private readonly db: AppDatabase,
    private readonly workflowService: ContentWorkflowService,
    private readonly onResult?: (payload: {
      generatedContentId: number;
      success: boolean;
      message: string;
    }) => Promise<void>
  ) {}

  start(): void {
    if (this.task) {
      return;
    }
    this.task = cron.schedule("*/1 * * * *", async () => {
      await this.processDuePosts();
    });
    this.serviceLogger.info("Scheduler started", { cron: "*/1 * * * *" });
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
    this.serviceLogger.info("Scheduler stopped");
  }

  async processDuePosts(): Promise<void> {
    if (this.isProcessing) {
      this.serviceLogger.warn("Skipping scheduler tick because previous run is active");
      return;
    }

    this.isProcessing = true;
    try {
      const due = this.db.listDueSchedules(dayjs().toISOString());
      if (!due.length) {
        return;
      }
      this.serviceLogger.info("Found due scheduled posts", { count: due.length });
      for (const item of due) {
        this.db.updateScheduleStatus(item.scheduleId, "running");
        try {
          const result = await this.workflowService.publishDraft(item.generatedContentId);
          this.db.updateScheduleStatus(item.scheduleId, result.success ? "published" : "failed");

          if (this.onResult) {
            await this.onResult({
              generatedContentId: item.generatedContentId,
              success: result.success,
              message: result.message
            });
          }
        } catch (error) {
          this.db.updateScheduleStatus(item.scheduleId, "failed");
          this.serviceLogger.error("Scheduled publish crashed", {
            generatedContentId: item.generatedContentId,
            scheduleId: item.scheduleId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      this.serviceLogger.error("Failed processing scheduled posts", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.isProcessing = false;
    }
  }
}
