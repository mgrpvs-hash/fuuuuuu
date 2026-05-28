import { AssistantCommandService } from "../services/assistant-command.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const service = new AssistantCommandService();

  assert(service.classify("придумай идеи для постов").type === "generate_ideas", "ideas classification failed");
  assert(
    service.classify("сделай картинку с надписью доброе утро").type === "create_text_poster",
    "create_text_poster classification failed"
  );
  assert(
    service.classify("сделай постер без фото").type === "create_text_poster",
    "create_text_poster without photo classification failed"
  );
  assert(
    service.classify("сделай дизайн премиальнее").type === "edit_design",
    "edit_design classification failed"
  );
  assert(service.classify("сделай текст короче").type === "edit_caption", "edit_caption classification failed");
  assert(service.classify("публикуй").type === "approve_intent", "approve_intent classification failed");
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

try {
  main();
} catch (error) {
  console.error(`test:assistant failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

