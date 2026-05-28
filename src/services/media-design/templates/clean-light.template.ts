import { MediaDesignTemplate } from "./types.js";

export const cleanLightTemplate: MediaDesignTemplate = {
  id: "clean_light",
  label: "Clean",
  mode: "stacked",
  topZone: { x: 64, y: 64, width: 952, height: 130, radius: 26 },
  imageZone: { x: 64, y: 228, width: 952, height: 904, radius: 30 },
  bottomZone: { x: 64, y: 1168, width: 952, height: 118, radius: 24 },
  minSpacing: 32,
  titleAlign: "left",
  backgroundGradient: { start: "#f5f9fd", end: "#edf4fb" },
  palette: {
    title: "#143149",
    tag: "#2f6a9a",
    brand: "#12334d",
    handle: "#2e6c9d",
    disclaimer: "#5d7388",
    cardFill: "#ffffff",
    cardStroke: "#d7e4f1"
  },
  imageForegroundInset: 24,
  imageBlurStrength: 14,
  showMedicalCrossByDefault: false
};

