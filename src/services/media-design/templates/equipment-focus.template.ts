import { MediaDesignTemplate } from "./types.js";

export const equipmentFocusTemplate: MediaDesignTemplate = {
  id: "equipment_focus",
  label: "Equipment",
  mode: "stacked",
  topZone: { x: 64, y: 64, width: 952, height: 118, radius: 24 },
  imageZone: { x: 40, y: 216, width: 1000, height: 980, radius: 30 },
  bottomZone: { x: 90, y: 1228, width: 900, height: 96, radius: 20 },
  minSpacing: 32,
  titleAlign: "center",
  backgroundGradient: { start: "#f2f8ff", end: "#e9f2fa" },
  palette: {
    title: "#102f4a",
    tag: "#2d6797",
    brand: "#12324c",
    handle: "#2f6d9f",
    disclaimer: "#5b7087",
    cardFill: "#ffffff",
    cardStroke: "#cfdeeb"
  },
  imageForegroundInset: 12,
  imageBlurStrength: 13,
  showMedicalCrossByDefault: false
};

