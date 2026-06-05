export type ContentType = "post" | "reel" | "story";
export type Language = "ru" | "en";
export type DraftStatus = "draft" | "approved" | "scheduled" | "published" | "failed";
export type MediaType = "image" | "video";

export interface UserSettings {
  userId: number;
  tone: string;
  language: Language;
}

export interface DraftInput {
  telegramUserId: number;
  contentType: ContentType;
  language: Language;
  tone: string;
  description: string;
  mediaItemId: number;
}

export interface SafetyResult {
  blockedTerms: string[];
  hasUnsafeClaims: boolean;
  warningMessage?: string;
  saferTextSuggestion?: string;
}

export interface GeneratedContentPayload {
  captions: string[];
  hashtags: string[];
  cta: string;
  storyText: string;
  reelIdea?: string;
  riskWarning?: string;
  safeRewriteHint?: string;
}

export interface PublishResult {
  success: boolean;
  igMediaId?: string;
  igContainerId?: string;
  error?: string;
  warning?: string;
}
