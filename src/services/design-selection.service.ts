import { ContentType, Language } from "../types/domain.js";
import { MEDIA_DESIGN_TEMPLATE_IDS } from "./media-design/templates/index.js";
import { MediaDesignTemplateId } from "./media-design/templates/types.js";

type Orientation = "portrait" | "landscape" | "square" | "unknown";

const TEMPLATE_ROTATION_BY_TOPIC: Record<string, MediaDesignTemplateId[]> = {
  equipment: ["equipment_focus", "premium_card", "announcement"],
  room: ["clean_light", "full_bleed_blur", "minimal_storylike"],
  team: ["announcement", "premium_card", "clean_light"],
  educational: ["educational", "clean_light", "minimal_storylike"],
  general: ["clean_light", "minimal_storylike", "premium_card"]
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function detectTopic(description: string): keyof typeof TEMPLATE_ROTATION_BY_TOPIC {
  const text = normalize(description);
  if (
    /(аппарат|оборуд|diagnostic|scanner|ultrasound|x-ray|мрт|кт|device|technology|технолог)/i.test(text)
  ) {
    return "equipment";
  }
  if (/(комнат|ресепш|интерьер|зона|room|reception|interior|lobby|space)/i.test(text)) {
    return "room";
  }
  if (/(врач|доктор|команда|team|doctor|staff|specialist)/i.test(text)) {
    return "team";
  }
  if (/(совет|educat|how to|guide|почему|как|tips|faq)/i.test(text)) {
    return "educational";
  }
  return "general";
}

function orientationRank(orientation: Orientation, template: MediaDesignTemplateId): number {
  if (orientation === "portrait" && template === "split_layout") return -3;
  if (orientation === "landscape" && template === "equipment_focus") return 2;
  if (orientation === "portrait" && template === "full_bleed_blur") return 1;
  return 0;
}

export class DesignSelectionService {
  chooseTemplate(input: {
    contentType: ContentType;
    language: Language;
    description: string;
    visualTitle?: string;
    previousVariant?: MediaDesignTemplateId | null;
    orientation?: Orientation;
    preferredStyle?: MediaDesignTemplateId | null;
  }): { templateId: MediaDesignTemplateId; seed: string } {
    if (input.preferredStyle) {
      return {
        templateId: input.preferredStyle,
        seed: `${input.preferredStyle}:${Date.now()}`
      };
    }

    const topic = detectTopic(`${input.description} ${input.visualTitle ?? ""}`);
    const orientation = input.orientation ?? "unknown";
    const candidates = [...TEMPLATE_ROTATION_BY_TOPIC[topic]];

    if (input.contentType === "story") {
      candidates.unshift("minimal_storylike");
    }
    if (input.contentType === "reel") {
      candidates.unshift("full_bleed_blur");
    }
    if (input.language === "en" && !candidates.includes("premium_card")) {
      candidates.push("premium_card");
    }

    for (const templateId of MEDIA_DESIGN_TEMPLATE_IDS) {
      if (!candidates.includes(templateId)) {
        candidates.push(templateId);
      }
    }

    const ranked = candidates
      .map((templateId, index) => ({
        templateId,
        score:
          (input.previousVariant === templateId ? -10 : 0) +
          orientationRank(orientation, templateId) -
          index * 0.2
      }))
      .sort((a, b) => b.score - a.score);

    const selected = ranked[0]?.templateId ?? "clean_light";
    return {
      templateId: selected,
      seed: `${selected}:${Date.now()}`
    };
  }
}

