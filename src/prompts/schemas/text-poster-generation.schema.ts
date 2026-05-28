import { z } from "zod";

export const textPosterGenerationSchema = z.object({
  visual_title: z.string().min(1),
  visual_subtitle: z.string().default(""),
  short_overlay_text: z.string().default(""),
  poster_caption: z.string().min(1),
  cta: z.string().default(""),
  hashtags: z.array(z.string().min(1)).min(1),
  poster_type: z
    .enum([
      "morning_health",
      "medical_tip",
      "clinic_announcement",
      "minimalist_quote",
      "service_card",
      "educational_card"
    ])
    .default("medical_tip"),
  design_hint: z.string().default("medical_tip"),
  safety_notes: z.string().default("")
});

export type TextPosterGenerationSchema = z.infer<typeof textPosterGenerationSchema>;

