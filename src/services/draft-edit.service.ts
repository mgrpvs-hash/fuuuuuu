import { AppDatabase, DbGeneratedContent } from "../db/database.js";
import { Language } from "../types/domain.js";
import { AssistantCommandService, DraftInstructionResult } from "./assistant-command.service.js";
import { formatInstagramCaption } from "./caption-formatter.service.js";
import { OpenAiService } from "./openai.service.js";

type ApplyDraftInstructionInput = {
  draftId: number;
  userId: number;
  instruction: string;
};

type ApplyDraftInstructionResult = {
  classification: DraftInstructionResult;
  draft: DbGeneratedContent;
  shouldRegenerateDesign: boolean;
  shouldRegenerateText: boolean;
  preferredStyle?: string;
  overlayDensity?: "minimal" | "medium" | "detailed";
  requiresApproveButton: boolean;
  requiresClarification: boolean;
  clarificationMessage?: string;
  showCarouselSuggestion?: boolean;
  availableActions: string[];
};

const DEFAULT_DRAFT_ACTIONS = [
  "approve",
  "regenerate_text",
  "regenerate_design",
  "change_style",
  "more_overlay_text",
  "less_overlay_text",
  "remove_hashtags",
  "use_original",
  "cancel"
];

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function removeHashtagsFromCaption(caption: string): string {
  return caption
    .replace(/\s*#[\p{L}\p{N}_]+/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shortenCaption(caption: string): string {
  const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const noTags = removeHashtagsFromCaption(caption);
  const limit = Math.max(260, Math.floor(noTags.length * 0.7));
  const shortened = noTags.length > limit ? `${noTags.slice(0, limit).trimEnd()}…` : noTags;
  return [shortened, hashtags.join(" ")].filter(Boolean).join("\n\n").trim();
}

function makeProfessional(caption: string): string {
  return caption
    .replace(/крутой|супер|вау|wow/gi, "профессиональный")
    .replace(/приходите прямо сейчас/gi, "запишитесь на консультацию")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDraftContext(draft: DbGeneratedContent): string {
  return [
    `content_type=${draft.content_type}`,
    `language=${draft.language}`,
    `description=${draft.description}`,
    `visual_title=${draft.visual_title ?? ""}`,
    `visual_subtitle=${draft.visual_subtitle ?? ""}`,
    `overlay_density=${draft.overlay_density ?? "medium"}`,
    `caption=${draft.final_instagram_caption ?? draft.selected_caption ?? ""}`,
    `hashtags=${draft.hashtags_json}`
  ].join("\n");
}

function normalizeBullets(input: string[], language: Language): string[] {
  const limit = language === "ru" ? 55 : 50;
  return input
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => (line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line));
}

export class DraftEditService {
  constructor(
    private readonly db: AppDatabase,
    private readonly assistantCommandService: AssistantCommandService,
    private readonly aiService: OpenAiService
  ) {}

  async applyDraftInstruction(input: ApplyDraftInstructionInput): Promise<ApplyDraftInstructionResult> {
    const draft = this.db.getGeneratedContentByIdForTelegramUser(input.draftId, input.userId);
    const classification = await this.assistantCommandService.classifyDraftInstruction(
      input.instruction,
      buildDraftContext(draft),
      async ({ userText, draftContext }) => {
        const llm = await this.aiService.classifyDraftInstructionLLM({
          userText,
          draftContext,
          language: draft.language
        });
        if (!llm) return null;
        return {
          intent: llm.intent as DraftInstructionResult["intent"],
          confidence: llm.confidence,
          params: llm.params as DraftInstructionResult["params"],
          userFacingSummary: llm.userFacingSummary
        };
      }
    );

    if (classification.intent === "approve_intent") {
      return {
        classification,
        draft,
        shouldRegenerateDesign: false,
        shouldRegenerateText: false,
        requiresApproveButton: true,
        requiresClarification: false,
        availableActions: DEFAULT_DRAFT_ACTIONS
      };
    }

    if (classification.intent === "clarify") {
      return {
        classification,
        draft,
        shouldRegenerateDesign: false,
        shouldRegenerateText: false,
        requiresApproveButton: false,
        requiresClarification: true,
        clarificationMessage: "Понял. Хотите изменить текст, дизайн или текст на картинке?",
        availableActions: DEFAULT_DRAFT_ACTIONS
      };
    }

    if (classification.intent === "remove_hashtags") {
      const updatedCaption = removeHashtagsFromCaption(draft.final_instagram_caption ?? draft.selected_caption ?? "");
      this.db.updateGeneratedDraftEdit({
        contentId: draft.id,
        hashtags: [],
        finalCaption: updatedCaption
      });
      return {
        classification,
        draft: this.db.getGeneratedContentById(draft.id)!,
        shouldRegenerateDesign: false,
        shouldRegenerateText: false,
        requiresApproveButton: false,
        requiresClarification: false,
        availableActions: DEFAULT_DRAFT_ACTIONS
      };
    }

    if (classification.intent === "edit_caption") {
      let caption = draft.final_instagram_caption ?? draft.selected_caption ?? "";
      if (classification.params.makeShorter) {
        caption = shortenCaption(caption);
      }
      if (classification.params.makeMoreProfessional) {
        caption = makeProfessional(caption);
      }

      if (classification.params.captionInstruction && !classification.params.makeShorter) {
        const generated = await this.aiService.generateDraftEditContent({
          language: draft.language,
          instruction: classification.params.captionInstruction,
          draftContext: buildDraftContext(draft)
        });
        caption = generated.finalCaption || caption;
        const formatted = formatInstagramCaption({
          selectedCaption: caption,
          cta: generated.cta || draft.cta,
          hashtags: generated.hashtags.length ? generated.hashtags : parseJsonArray(draft.hashtags_json),
          contentType: draft.content_type
        });
        this.db.updateGeneratedDraftEdit({
          contentId: draft.id,
          finalCaption: formatted.caption,
          hashtags: formatted.hashtags,
          cta: generated.cta || draft.cta,
          designHint: generated.designHint || draft.design_hint || undefined
        });
      } else {
        this.db.updateGeneratedDraftEdit({
          contentId: draft.id,
          finalCaption: caption
        });
      }

      return {
        classification,
        draft: this.db.getGeneratedContentById(draft.id)!,
        shouldRegenerateDesign: false,
        shouldRegenerateText: false,
        requiresApproveButton: false,
        requiresClarification: false,
        availableActions: DEFAULT_DRAFT_ACTIONS
      };
    }

    const shouldRunAiEdit =
      classification.intent === "increase_overlay_text" ||
      classification.intent === "decrease_overlay_text" ||
      classification.intent === "edit_overlay_text" ||
      classification.intent === "edit_design" ||
      classification.intent === "regenerate_design" ||
      classification.intent === "regenerate_text" ||
      classification.intent === "change_style";

    if (shouldRunAiEdit) {
      const localOverlayBullets = [
        "Удобная зона ожидания",
        "Внимание к каждому пациенту",
        "Современное пространство для приёма"
      ];
      const generated =
        classification.confidence >= 0.9 && classification.intent !== "regenerate_text"
          ? {
              visualTitle: draft.visual_title || "Комфортный визит в клинику",
              visualSubtitle:
                draft.visual_subtitle || "Создаём пространство, где пациентам спокойно и удобно.",
              overlayBullets:
                classification.intent === "decrease_overlay_text"
                  ? []
                  : classification.intent === "increase_overlay_text"
                    ? localOverlayBullets
                    : normalizeBullets(parseJsonArray(draft.overlay_bullets_json), draft.language),
              finalCaption: draft.final_instagram_caption || draft.selected_caption || "",
              hashtags: parseJsonArray(draft.hashtags_json),
              cta: draft.cta,
              designHint: classification.params.styleVariant ?? draft.design_hint ?? "",
              overlayDensity:
                classification.params.overlayDensity ??
                (classification.intent === "increase_overlay_text"
                  ? "detailed"
                  : classification.intent === "decrease_overlay_text"
                    ? "minimal"
                    : classification.params.styleVariant === "educational"
                      ? "detailed"
                      : ((draft.overlay_density as "minimal" | "medium" | "detailed" | null) ?? "medium"))
            }
          : await this.aiService.generateDraftEditContent({
              language: draft.language,
              instruction: input.instruction,
              draftContext: buildDraftContext(draft)
            });
      const density =
        classification.params.overlayDensity ??
        generated.overlayDensity ??
        (draft.overlay_density as "minimal" | "medium" | "detailed" | null) ??
        "medium";

      const bullets = normalizeBullets(generated.overlayBullets, draft.language);
      const hashtags = generated.hashtags.length ? generated.hashtags : parseJsonArray(draft.hashtags_json);
      const formatted = formatInstagramCaption({
        selectedCaption: generated.finalCaption || draft.final_instagram_caption || draft.selected_caption || "",
        cta: generated.cta || draft.cta,
        hashtags,
        contentType: draft.content_type
      });
      const finalCaption = classification.params.makeShorter ? shortenCaption(formatted.caption) : formatted.caption;

      this.db.updateGeneratedDraftEdit({
        contentId: draft.id,
        visualTitle: generated.visualTitle || draft.visual_title || undefined,
        visualSubtitle: generated.visualSubtitle || draft.visual_subtitle || undefined,
        overlayBullets: bullets,
        overlayDensity: density,
        cta: generated.cta || draft.cta,
        hashtags: formatted.hashtags,
        finalCaption,
        designHint: generated.designHint || classification.params.styleVariant || draft.design_hint || undefined
      });

      const updatedDraft = this.db.getGeneratedContentById(draft.id)!;
      const showCarouselSuggestion =
        density === "detailed" && (bullets.length >= 3 || (generated.finalCaption ?? "").length > 1200);

      return {
        classification,
        draft: updatedDraft,
        shouldRegenerateDesign: classification.intent !== "regenerate_text",
        shouldRegenerateText: classification.intent === "regenerate_text",
        preferredStyle: classification.params.styleVariant ?? generated.designHint,
        overlayDensity: density,
        requiresApproveButton: false,
        requiresClarification: false,
        showCarouselSuggestion,
        availableActions: DEFAULT_DRAFT_ACTIONS
      };
    }

    return {
      classification,
      draft,
      shouldRegenerateDesign: false,
      shouldRegenerateText: false,
      requiresApproveButton: false,
      requiresClarification: true,
      clarificationMessage: "Понял. Хотите изменить текст, дизайн или текст на картинке?",
      availableActions: DEFAULT_DRAFT_ACTIONS
    };
  }
}

