import { MediaDesignTemplate } from "./types.js";

export const splitLayoutTemplate: MediaDesignTemplate = {
  id: "split_layout",
  label: "Split",
  mode: "split_layout",
  topZone: { x: 676, y: 72, width: 332, height: 744, radius: 24 },
  imageZone: { x: 64, y: 72, width: 580, height: 1214, radius: 28 },
  bottomZone: { x: 676, y: 848, width: 332, height: 438, radius: 24 },
  minSpacing: 32,
  titleAlign: "left",
  backgroundGradient: { start: "#f4f9fe", end: "#eaf2fb" },
  palette: {
    title: "#122f48",
    tag: "#2d6a98",
    brand: "#14344d",
    handle: "#2e6897",
    disclaimer: "#60768b",
    cardFill: "#ffffff",
    cardStroke: "#d5e2ee"
  },
  imageForegroundInset: 16,
  imageBlurStrength: 15,
  showMedicalCrossByDefault: false
};

