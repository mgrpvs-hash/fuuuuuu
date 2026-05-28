import { Language } from "../types/domain.js";

export type AgentRouterAction =
  | "create_visual"
  | "create_text_poster"
  | "generate_ai_image"
  | "edit_current_draft"
  | "generate_caption"
  | "generate_ideas"
  | "create_content_plan"
  | "analyze_competitor"
  | "create_carousel"
  | "publish_intent"
  | "schedule_intent"
  | "general_chat"
  | "medical_question_safe_response"
  | "unclear";

export type AgentVisualType = "poster" | "ai_image" | "photo_design" | "carousel" | "story" | "reel_cover";
export type AgentVisualStyle = "clean" | "premium" | "minimal" | "educational" | "bold" | "medical";

export interface AgentRouterInput {
  userText: string;
  hasActiveDraft: boolean;
  hasAttachedMedia: boolean;
  currentDraftSummary?: string;
  language: Language;
}

export interface AgentRouterOutput {
  action: AgentRouterAction;
  confidence: number;
  params: {
    topic?: string;
    visualType?: AgentVisualType;
    style?: AgentVisualStyle;
    needsImageGeneration?: boolean;
    needsPosterOnly?: boolean;
    competitorUrl?: string;
    instruction?: string;
    language?: "RU" | "EN";
  };
  userFacingPlan: string;
}

function extractCompetitorUrl(text: string): string | undefined {
  const url = text.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) return url;
  const igHandle = text.match(/@[a-z0-9._]{2,}/i)?.[0];
  return igHandle ?? undefined;
}

function extractTopic(text: string): string {
  return text
    .replace(
      /(сделай|создай|сгенерируй|подготовь|пожалуйста|please|визуал|фото|картинку|картинку|постер|пост|сам)/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function result(
  action: AgentRouterAction,
  confidence: number,
  userFacingPlan: string,
  params: AgentRouterOutput["params"] = {}
): AgentRouterOutput {
  return {
    action,
    confidence,
    userFacingPlan,
    params
  };
}

export class AgentRouterService {
  route(input: AgentRouterInput): AgentRouterOutput {
    const text = input.userText.trim();
    const normalized = text.toLowerCase();
    const topic = extractTopic(text);

    if (
      /(какой\s+у\s+меня\s+диагноз|постав(ь|ьте).+диагноз|что\s+мне\s+принимать|назнач(ь|ьте).+лечение|what diagnosis|prescribe treatment)/i.test(
        normalized
      )
    ) {
      return result(
        "medical_question_safe_response",
        0.98,
        "Дам безопасный ответ без диагностики и назначений."
      );
    }

    if (/(публикуй|approve|выкладывай|publish now)/i.test(normalized)) {
      return result("publish_intent", 0.99, "Запрос публикации. Нужна кнопка Approve.");
    }

    if (/(schedule|запланируй|поставь\s+на\s+время|публикац.+позже)/i.test(normalized)) {
      return result("schedule_intent", 0.95, "Подготовлю отложенную публикацию.");
    }

    if (/(контент\s*план|content plan|на неделю|week plan)/i.test(normalized)) {
      return result("create_content_plan", 0.98, "Соберу контент-план.", {
        topic: topic || undefined
      });
    }

    if (/(иде[йи]|ideas?|что постить|темы для постов)/i.test(normalized)) {
      return result("generate_ideas", 0.95, "Соберу идеи для контента.", {
        topic: topic || undefined
      });
    }

    if (/(конкурент|конкурентов|competitor|разбери\s+@|анализируй\s+@|посмотри\s+@)/i.test(normalized)) {
      return result("analyze_competitor", 0.96, "Сделаю безопасный разбор конкурента.", {
        competitorUrl: extractCompetitorUrl(text),
        instruction: text
      });
    }

    if (/(карусел|carousel)/i.test(normalized)) {
      return result("create_carousel", 0.92, "Подготовлю концепт карусели.", {
        visualType: "carousel",
        topic: topic || undefined
      });
    }

    if (
      input.hasActiveDraft &&
      /(сделай лучше|добавь текст|премиаль|короче|убери хэшт|дизайн|перепиши|сделай по-другому)/i.test(normalized)
    ) {
      return result("edit_current_draft", 0.94, "Обновлю текущий draft по инструкции.", {
        instruction: text
      });
    }

    const asksVisual = /(сделай|создай|сгенерируй).*(фотк|картинк|визуал|постер|фото|карточк|пост\s+сам)/i.test(
      normalized
    );

    if (asksVisual) {
      const requestsNoPhoto = /(без\s+фото|без\s+моего\s+фото)/i.test(normalized);
      const requestsPosterText = /(надпись|постер|quote|совет|card)/i.test(normalized);
      const requestsRealistic = /(реалистич|realistic|интерьер|комнат|clinic interior|photoreal|фотореал)/i.test(
        normalized
      );
      const style: AgentVisualStyle | undefined = /премиал|дорого|premium/.test(normalized)
        ? "premium"
        : /миним|minimal/.test(normalized)
          ? "minimal"
          : /инфограф|education/.test(normalized)
            ? "educational"
            : undefined;

      if (requestsRealistic && !requestsNoPhoto) {
        return result("generate_ai_image", 0.95, "Сгенерирую AI изображение и подготовлю draft.", {
          topic: topic || undefined,
          visualType: "ai_image",
          style,
          needsImageGeneration: true
        });
      }

      if (requestsNoPhoto) {
        return result("create_text_poster", 0.96, "Создам брендированный постер без фото.", {
          topic: topic || undefined,
          visualType: "poster",
          style,
          needsPosterOnly: true
        });
      }

      if (requestsPosterText || /(постер|цитат|tips?)/i.test(normalized)) {
        return result("create_visual", 0.94, "Создам визуал с текстом и безопасной подачей.", {
          topic: topic || undefined,
          visualType: "poster",
          style,
          needsPosterOnly: true
        });
      }

      return result("create_visual", 0.92, "Создам визуал для Instagram.", {
        topic: topic || undefined,
        visualType: input.hasAttachedMedia ? "photo_design" : "poster",
        style,
        needsImageGeneration: !input.hasAttachedMedia
      });
    }

    if (input.hasActiveDraft) {
      return result("edit_current_draft", 0.65, "Похоже на инструкцию для активного draft.", {
        instruction: text
      });
    }

    if (/(caption|подпись|описание для поста|сделай текст для поста)/i.test(normalized)) {
      return result("generate_caption", 0.82, "Подготовлю подпись.", {
        topic: topic || undefined
      });
    }

    if (!text) {
      return result("unclear", 0.1, "Нужен более понятный запрос.");
    }

    if (/(?:(?:да|ок|понял|хорошо)\b)/i.test(normalized)) {
      return result("unclear", 0.3, "Уточню, что именно создать.");
    }

    return result("general_chat", 0.7, "Отвечу как контент-ассистент.", {
      instruction: text
    });
  }
}

