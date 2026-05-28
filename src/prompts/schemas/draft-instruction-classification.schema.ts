import { z } from "zod";

export const draftInstructionClassificationSchema = z.object({
  intent: z.enum([
    "edit_caption",
    "edit_design",
    "edit_overlay_text",
    "increase_overlay_text",
    "decrease_overlay_text",
    "change_style",
    "regenerate_design",
    "regenerate_text",
    "remove_hashtags",
    "use_original",
    "cancel",
    "schedule",
    "approve_intent",
    "create_carousel_suggestion",
    "clarify"
  ]),
  confidence: z.number().min(0).max(1),
  params: z
    .object({
      styleVariant: z.string().optional(),
      language: z.enum(["RU", "EN"]).optional(),
      captionInstruction: z.string().optional(),
      designInstruction: z.string().optional(),
      overlayTextInstruction: z.string().optional(),
      overlayDensity: z.enum(["minimal", "medium", "detailed"]).optional(),
      bulletCount: z.number().min(0).max(3).optional(),
      removeHashtags: z.boolean().optional(),
      makeMoreProfessional: z.boolean().optional(),
      makeShorter: z.boolean().optional()
    })
    .default({}),
  userFacingSummary: z.string().default("")
});

export type DraftInstructionClassificationSchema = z.infer<
  typeof draftInstructionClassificationSchema
>;

