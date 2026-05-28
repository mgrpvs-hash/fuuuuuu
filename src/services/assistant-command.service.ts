import { Language } from "../types/domain.js";

export type AssistantIntentType =
  | "general_chat"
  | "generate_ideas"
  | "content_plan"
  | "create_text_poster"
  | "edit_caption"
  | "edit_design"
  | "change_language"
  | "use_original"
  | "cancel"
  | "approve_intent"
  | "unknown";

export interface AssistantIntent {
  type: AssistantIntentType;
  languageHint?: Language;
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
}

