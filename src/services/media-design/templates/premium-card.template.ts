import { MediaDesignTemplate } from "./types.js";

export const premiumCardTemplate: MediaDesignTemplate = {
  id: "premium_card",
  label: "Premium",
  mode: "stacked",
  topZone: { x: 76, y: 72, width: 928, height: 148, radius: 30 },
  imageZone: { x: 76, y: 258, width: 928, height: 860, radius: 34 },
  bottomZone: { x: 76, y: 1150, width: 928, height: 140, radius: 28 },
  minSpacing: 32,
  titleAlign: "left",
  backgroundGradient: { start: "#f7fbff", end: "#edf3fa" },
  palette: {
    title: "#122b42",
    tag: "#255f92",
    brand: "#102d49",
    handle: "#295f8f",
    disclaimer: "#5a6f86",
    cardFill: "#ffffff",
    cardStroke: "#d2dfec"
  },
  imageForegroundInset: 28,
  imageBlurStrength: 16,
  showMedicalCrossByDefault: true
};

