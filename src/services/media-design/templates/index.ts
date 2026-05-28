import { announcementTemplate } from "./announcement.template.js";
import { cleanLightTemplate } from "./clean-light.template.js";
import { educationalTemplate } from "./educational.template.js";
import { equipmentFocusTemplate } from "./equipment-focus.template.js";
import { fullBleedBlurTemplate } from "./full-bleed-blur.template.js";
import { minimalStorylikeTemplate } from "./minimal-storylike.template.js";
import { premiumCardTemplate } from "./premium-card.template.js";
import { splitLayoutTemplate } from "./split-layout.template.js";
import { MediaDesignTemplate, MediaDesignTemplateId } from "./types.js";

export const mediaDesignTemplates: Record<MediaDesignTemplateId, MediaDesignTemplate> = {
  clean_light: cleanLightTemplate,
  premium_card: premiumCardTemplate,
  equipment_focus: equipmentFocusTemplate,
  announcement: announcementTemplate,
  educational: educationalTemplate,
  minimal_storylike: minimalStorylikeTemplate,
  split_layout: splitLayoutTemplate,
  full_bleed_blur: fullBleedBlurTemplate
};

export const MEDIA_DESIGN_TEMPLATE_IDS = Object.keys(mediaDesignTemplates) as MediaDesignTemplateId[];

export function getMediaDesignTemplate(id: MediaDesignTemplateId): MediaDesignTemplate {
  return mediaDesignTemplates[id];
}

