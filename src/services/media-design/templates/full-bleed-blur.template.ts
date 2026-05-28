import { MediaDesignTemplate } from "./types.js";

export const fullBleedBlurTemplate: MediaDesignTemplate = {
  id: "full_bleed_blur",
  label: "Blur",
  mode: "full_bleed",
  topZone: { x: 64, y: 64, width: 952, height: 114, radius: 22 },
  imageZone: { x: 64, y: 214, width: 952, height: 922, radius: 34 },
  bottomZone: { x: 64, y: 1170, width: 952, height: 116, radius: 22 },
  minSpacing: 32,
  titleAlign: "center",
  backgroundGradient: { start: "#eff6fd", end: "#e4edf7" },
  palette: {
    title: "#ffffff",
    tag: "#d2e8ff",
    brand: "#ffffff",
    handle: "#e4f1ff",
    disclaimer: "#d2e3f4",
    cardFill: "#17324dcc",
    cardStroke: "#2f4d6bcc"
  },
  imageForegroundInset: 20,
  imageBlurStrength: 22,
  showMedicalCrossByDefault: false
};

