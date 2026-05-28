import { AssistantCommandService } from "../services/assistant-command.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const service = new AssistantCommandService();

  assert(
    service.classify("сделай картинку с надписью доброе утро").type === "create_text_poster",
    "create_text_poster classification failed"
  );
  assert(service.classify("сделай постер без фото").type === "create_text_poster", "poster no photo failed");
  assert(service.classify("придумай идеи для постов").type === "generate_ideas", "ideas classification failed");
  assert(service.classify("публикуй").type === "approve_intent", "approve intent classification failed");

  const ctx = "active draft context";
  const c1 = await service.classifyDraftInstruction(
    "смотри добавь больше текста и разъяснений в фотку текста",
    ctx
  );
  assert(c1.intent === "increase_overlay_text", "increase_overlay_text phrase failed");
  assert(c1.params.overlayDensity === "detailed", "overlayDensity detailed expected");

  const c2 = await service.classifyDraftInstruction("добавь больше текста на картинку", ctx);
  assert(c2.intent === "increase_overlay_text", "add more text phrase failed");

  const c3 = await service.classifyDraftInstruction("сделай как инфографику", ctx);
  assert(c3.intent === "edit_design", "infographic phrase failed");
  assert(c3.params.styleVariant === "educational", "educational style expected");

  const c4 = await service.classifyDraftInstruction("убери текст с картинки", ctx);
  assert(c4.intent === "decrease_overlay_text", "decrease overlay phrase failed");

  const c5 = await service.classifyDraftInstruction("сделай текст короче", ctx);
  assert(c5.intent === "edit_caption", "shorter caption phrase failed");

  const c6 = await service.classifyDraftInstruction("убери хэштеги", ctx);
  assert(c6.intent === "remove_hashtags", "remove hashtags phrase failed");

  const c7 = await service.classifyDraftInstruction("публикуй", ctx);
  assert(c7.intent === "approve_intent", "approve intent in draft mode failed");

  assert(
    service.isMedicalAdviceQuestion("поставь мне диагноз по симптомам"),
    "medical diagnosis safety detection failed"
  );
  assert(
    service.buildMedicalSafetyReply("ru").includes("не заменяю консультацию врача"),
    "medical refusal message failed"
  );

  console.log("test:assistant passed");
}

main().catch((error) => {
  console.error(`test:assistant failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

