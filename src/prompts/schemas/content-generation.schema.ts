import { z } from "zod";

export const contentGenerationSchema = z.object({
  captions: z.array(z.string().min(1)).min(2).max(3),
  hashtags: z.array(z.string().min(1)).min(1),
  cta: z.string().default(""),
  story_text: z.string().default(""),
  reel_idea: z.string().default(""),
  risk_warning: z.string().default(""),
  safe_rewrite_hint: z.string().default("")
});

export type ContentGenerationSchema = z.infer<typeof contentGenerationSchema>;
