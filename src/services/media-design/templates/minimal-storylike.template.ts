import { MediaDesignTemplate } from "./types.js";

export const minimalStorylikeTemplate: MediaDesignTemplate = {
  id: "minimal_storylike",
  label: "Minimal",
  mode: "stacked",
  topZone: { x: 92, y: 72, width: 896, height: 108, radius: 20 },
  imageZone: { x: 50, y: 214, width: 980, height: 910, radius: 18 },
  bottomZone: { x: 92, y: 1160, width: 896, height: 126, radius: 18 },
  minSpacing: 32,
  titleAlign: "center",
  backgroundGradient: { start: "#f7fbff", end: "#f0f6fc" },
  palette: {
    title: "#15344d",
    tag: "#3a739f",
    brand: "#163851",
    handle: "#2f6f9f",
    disclaimer: "#657c91",
    cardFill: "#ffffff",
    cardStroke: "#dbe7f2"
  },
  imageForegroundInset: 14,
  imageBlurStrength: 12,
  showMedicalCrossByDefault: false
};

