export type MediaDesignTemplateId =
  | "clean_light"
  | "premium_card"
  | "equipment_focus"
  | "announcement"
  | "educational"
  | "minimal_storylike"
  | "split_layout"
  | "full_bleed_blur";

export type MediaLayoutMode = "stacked" | "split_layout" | "full_bleed";

export type TextAlignMode = "left" | "center";

export interface TemplateZone {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface MediaDesignTemplate {
  id: MediaDesignTemplateId;
  label: string;
  mode: MediaLayoutMode;
  topZone: TemplateZone;
  imageZone: TemplateZone;
  bottomZone: TemplateZone;
  minSpacing: number;
  titleAlign: TextAlignMode;
  backgroundGradient: { start: string; end: string };
  palette: {
    title: string;
    tag: string;
    brand: string;
    handle: string;
    disclaimer: string;
    cardFill: string;
    cardStroke: string;
  };
  imageForegroundInset: number;
  imageBlurStrength: number;
  showMedicalCrossByDefault: boolean;
}

