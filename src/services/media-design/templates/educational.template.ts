import { MediaDesignTemplate } from "./types.js";

export const educationalTemplate: MediaDesignTemplate = {
  id: "educational",
  label: "Educational",
  mode: "stacked",
  topZone: { x: 64, y: 64, width: 952, height: 154, radius: 24 },
  imageZone: { x: 64, y: 252, width: 952, height: 686, radius: 26 },
  bottomZone: { x: 64, y: 970, width: 952, height: 316, radius: 24 },
  minSpacing: 32,
  titleAlign: "left",
  backgroundGradient: { start: "#f4f9ff", end: "#eaf2fa" },
  palette: {
    title: "#12314a",
    tag: "#2b6a9b",
    brand: "#113049",
    handle: "#2d699a",
    disclaimer: "#5b7389",
    cardFill: "#ffffff",
    cardStroke: "#d4e1ee"
  },
  imageForegroundInset: 22,
  imageBlurStrength: 14,
  showMedicalCrossByDefault: false
};

