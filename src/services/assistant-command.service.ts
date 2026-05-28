import { Language } from "../types/domain.js";

export type AssistantIntentType =
  | "general_chat"
  | "generate_ideas"
  | "content_plan"
  | "create_text_poster"
  | "edit_caption"
  | "edit_design"
  | "edit_overlay_text"
  | "increase_overlay_text"
  | "decrease_overlay_text"
  | "change_style"
  | "regenerate_design"
  | "regenerate_text"
  | "remove_hashtags"
  | "use_original"
  | "cancel"
  | "schedule"
  | "approve_intent"
  | "create_carousel_suggestion"
  | "change_language"
  | "clarify"
  | "unknown";

export interface AssistantIntentParams {
  styleVariant?: string;
  language?: "RU" | "EN";
  captionInstruction?: string;
  designInstruction?: string;
  overlayTextInstruction?: string;
  overlayDensity?: "minimal" | "medium" | "detailed";
  bulletCount?: number;
  removeHashtags?: boolean;
  makeMoreProfessional?: boolean;
  makeShorter?: boolean;
}

export interface AssistantIntent {
  type: AssistantIntentType;
  languageHint?: Language;
}

export interface DraftInstructionResult {
  intent: AssistantIntentType;
  confidence: number;
  params: AssistantIntentParams;
  userFacingSummary: string;
}

const MEDICAL_DIAGNOSIS_PATTERNS = [
  /какой\s+у\s+меня\s+диагноз/i,
  /постав(ь|ьте)\s+.*диагноз/i,
  /what\s+diagnosis/i,
  /назнач(ь|и)\s+лечение/i,
  /что\s+мне\s+принимать/i,
  /what medication should i take/i,
  /stop my medication/i
];

type DraftClassifierFallback = (input: {
  userText: string;
  draftContext: string;
}) => Promise<DraftInstructionResult | null>;

function buildResult(
  intent: AssistantIntentType,
  confidence: number,
  summary: string,
  params: AssistantIntentParams = {}
): DraftInstructionResult {
  return {
    intent,
    confidence,
    params,
    userFacingSummary: summary
  };
}

export class AssistantCommandService {
  classify(text: string): AssistantIntent {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return { type: "unknown" };

    if (
      /(сделай\s+(картинк|фото|постер|карточк|визуал)|без\s+фото|просто\s+текст\s+на\s+картинке|картинка\s+для\s+инстаграма|пост\s+с\s+надписью|афиша|утренний\s+пост|мотивационный\s+пост|инфографика|make\s+(image|poster|visual|graphic))/i.test(
        normalized
      )
    ) {
      return { type: "create_text_poster" };
    }

    if (/(иде[йи]|ideas?|контент[- ]?план|content plan)/i.test(normalized)) {
      if (/план|content plan|на неделю|week/i.test(normalized)) {
        return { type: "content_plan" };
      }
      return { type: "generate_ideas" };
    }

    if (/(публикуй|approve|выкладывай|давай пост|post it)/i.test(normalized)) {
      return { type: "approve_intent" };
    }
    if (/(отмен[аи]|cancel)/i.test(normalized)) {
      return { type: "cancel" };
    }
    if (/(оригинал|use original)/i.test(normalized)) {
      return { type: "use_original" };
    }
    if (/(design|дизайн|шаблон|style|премиаль|вариант)/i.test(normalized)) {
      return { type: "edit_design" };
    }
    if (
      /(короче|shorter|rewrite|перепиши|сделай текст|убери хэшт|more professional|профессиональ)/i.test(
        normalized
      )
    ) {
      return { type: "edit_caption" };
    }
    if (/(на английском|english|на русском|русск)/i.test(normalized)) {
      return { type: "change_language", languageHint: /english|англ/i.test(normalized) ? "en" : "ru" };
    }

    return { type: "general_chat" };
  }

  isMedicalAdviceQuestion(text: string): boolean {
    return MEDICAL_DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(text));
  }

  buildMedicalSafetyReply(language: Language = "ru"): string {
    if (language === "en") {
      return "I can help with informational content and social media copy, but I do not replace a doctor consultation. Please consult a licensed clinician for medical decisions.";
    }
    return "Я могу помочь с информационным текстом и контентом, но не заменяю консультацию врача. Для медицинских решений обратитесь к специалисту.";
  }

  async classifyDraftInstruction(
    userText: string,
    draftContext: string,
    fallbackClassifier?: DraftClassifierFallback
  ): Promise<DraftInstructionResult> {
    const normalized = userText.trim().toLowerCase();

    if (/(публикуй|approve|выкладывай|давай пост)/i.test(normalized)) {
      return buildResult("approve_intent", 0.99, "Запрос на публикацию");
    }
    if (/(отмена|отмена драфта|cancel)/i.test(normalized)) {
      return buildResult("cancel", 0.98, "Отменить draft");
    }
    if (/(оригинал|use original)/i.test(normalized)) {
      return buildResult("use_original", 0.98, "Использовать оригинальное фото");
    }
    if (/(schedule|запланируй|запланировать|поставь по времени)/i.test(normalized)) {
      return buildResult("schedule", 0.9, "Запланировать публикацию");
    }
    if (/(убери\s+хэшт|remove hashtags)/i.test(normalized)) {
      return buildResult("remove_hashtags", 0.99, "Удалить хэштеги", { removeHashtags: true });
    }
    if (/(сделай\s+текст\s+короче|короче|shorter)/i.test(normalized)) {
      return buildResult("edit_caption", 0.95, "Сделать caption короче", { makeShorter: true });
    }
    if (/(more professional|профессиональ)/i.test(normalized)) {
      return buildResult("edit_caption", 0.92, "Сделать текст профессиональнее", {
        makeMoreProfessional: true
      });
    }
    if (/(добавь\s+cta|cta\s+на\s+консультац)/i.test(normalized)) {
      return buildResult("edit_caption", 0.95, "Добавить CTA на консультацию", {
        captionInstruction: "Добавить CTA на консультацию."
      });
    }
    if (
      /(смотри\s+добавь\s+больше\s+текста\s+и\s+разъяснений\s+в\s+фотку\s+текста|добавь\s+больше\s+текста\s+на\s+картинку|добавь\s+разъяснения\s+прямо\s+на\s+фото|добавь\s+текст\s+на\s+картинку|можешь\s+сам\s+сделать\s+фото\s+с\s+надписью)/i.test(
        normalized
      )
    ) {
      return buildResult("increase_overlay_text", 0.99, "Увеличить текст на изображении", {
        overlayDensity: "detailed",
        bulletCount: 3,
        overlayTextInstruction: userText
      });
    }
    if (/(сделай\s+как\s+инфографик)/i.test(normalized)) {
      return buildResult("edit_design", 0.97, "Сделать инфографичный стиль", {
        styleVariant: "educational",
        overlayDensity: "detailed",
        bulletCount: 3,
        designInstruction: "Инфографичный стиль с разъяснениями."
      });
    }
    if (/(убери\s+текст\s+с\s+картинки|оставь\s+только\s+заголовок|less text on image)/i.test(normalized)) {
      return buildResult("decrease_overlay_text", 0.99, "Уменьшить текст на изображении", {
        overlayDensity: "minimal"
      });
    }
    if (/(больше\s+текста\s+в\s+картинке.*описание\s+короче)/i.test(normalized)) {
      return buildResult("increase_overlay_text", 0.95, "Добавить текста на изображение и укоротить caption", {
        overlayDensity: "detailed",
        bulletCount: 3,
        makeShorter: true
      });
    }
    if (/(сделай\s+дизайн\s+премиальнее|сделай\s+современно\s+и\s+дорого)/i.test(normalized)) {
      return buildResult("edit_design", 0.96, "Сделать дизайн премиальнее", {
        styleVariant: "premium_card",
        designInstruction: userText
      });
    }
    if (/(сделай\s+по-другому|сделай\s+картинку\s+лучше|regenerate design|сделай\s+картинку\s+иначе)/i.test(normalized)) {
      return buildResult("regenerate_design", 0.85, "Пересобрать дизайн", {
        designInstruction: userText
      });
    }
    if (/(regenerate text|перегенерируй текст|обнови текст)/i.test(normalized)) {
      return buildResult("regenerate_text", 0.84, "Пересобрать текст");
    }
    if (/(на английском|english)/i.test(normalized)) {
      return buildResult("change_language", 0.95, "Переключить язык на EN", { language: "EN" });
    }
    if (/(на русском|ru\b|русский)/i.test(normalized)) {
      return buildResult("change_language", 0.95, "Переключить язык на RU", { language: "RU" });
    }

    if (fallbackClassifier) {
      const llmResult = await fallbackClassifier({ userText, draftContext });
      if (llmResult && llmResult.confidence >= 0.55) {
        return llmResult;
      }
      if (llmResult && llmResult.confidence >= 0.35) {
        return buildResult("clarify", llmResult.confidence, "Нужна уточняющая команда", llmResult.params);
      }
    }

    return buildResult(
      "clarify",
      0.2,
      "Понял. Хотите изменить текст, дизайн или текст на картинке?"
    );
  }
}

