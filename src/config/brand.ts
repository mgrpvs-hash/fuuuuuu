export type BrandVisualStyle = "clean" | "premium" | "minimal" | "educational" | "bold" | "medical";

export const brandConfig = {
  clinicName: "MC Clinic Medical",
  handle: "@mc_clinic.du",
  tone: ["professional", "warm", "safe", "simple"] as const,
  bannedClaims: ["100% result", "guaranteed cure", "no risk", "best treatment"] as const,
  preferredCta: "Запишитесь на консультацию",
  contentPillars: [
    "equipment",
    "doctors/team",
    "patient comfort",
    "prevention",
    "clinic updates",
    "educational tips"
  ] as const,
  preferredVisualStyle: ["clean medical", "premium", "light", "calm"] as const
};

export function formatBrandSettings(): string {
  return [
    `Clinic: ${brandConfig.clinicName}`,
    `Handle: ${brandConfig.handle}`,
    `Tone: ${brandConfig.tone.join(", ")}`,
    `Preferred CTA: ${brandConfig.preferredCta}`,
    `Content pillars: ${brandConfig.contentPillars.join(", ")}`,
    `Preferred visual style: ${brandConfig.preferredVisualStyle.join(", ")}`,
    `Banned claims: ${brandConfig.bannedClaims.join(", ")}`
  ].join("\n");
}

