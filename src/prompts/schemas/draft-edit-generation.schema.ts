import { z } from "zod";

export const draftEditGenerationSchema = z.object({
  visual_title: z.string().default(""),
  visual_subtitle: z.string().default(""),
  overlay_bullets: z.array(z.string().min(1)).max(3).default([]),
  final_caption: z.string().default(""),
  hashtags: z.array(z.string().min(1)).default([]),
  cta: z.string().default(""),
  design_hint: z.string().default(""),
  overlay_density: z.enum(["minimal", "medium", "detailed"]).default("medium")
});

export type DraftEditGenerationSchema = z.infer<typeof draftEditGenerationSchema>;

