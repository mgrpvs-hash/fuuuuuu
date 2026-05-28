import { MediaDesignTemplate } from "./types.js";

export const announcementTemplate: MediaDesignTemplate = {
  id: "announcement",
  label: "Announcement",
  mode: "stacked",
  topZone: { x: 64, y: 64, width: 952, height: 192, radius: 30 },
  imageZone: { x: 76, y: 292, width: 928, height: 742, radius: 28 },
  bottomZone: { x: 64, y: 1070, width: 952, height: 216, radius: 24 },
  minSpacing: 32,
  titleAlign: "left",
  backgroundGradient: { start: "#f6fbff", end: "#eef5fb" },
  palette: {
    title: "#122d45",
    tag: "#356d9b",
    brand: "#15364f",
    handle: "#2e6b9d",
    disclaimer: "#60778d",
    cardFill: "#ffffff",
    cardStroke: "#d6e4f1"
  },
  imageForegroundInset: 24,
  imageBlurStrength: 14,
  showMedicalCrossByDefault: true
};

