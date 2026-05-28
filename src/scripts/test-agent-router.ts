import { AgentRouterService } from "../services/agent-router.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function route(
  service: AgentRouterService,
  text: string,
  hasActiveDraft = false
) {
  return service.route({
    userText: text,
    hasActiveDraft,
    hasAttachedMedia: false,
    currentDraftSummary: hasActiveDraft ? "active draft exists" : "",
    language: "ru"
  });
}

async function main(): Promise<void> {
  const service = new AgentRouterService();

  const r1 = route(service, "сделай фотку");
  assert(r1.action === "create_visual", "expected create_visual for 'сделай фотку'");

  const r2 = route(service, "сделай картинку доброе утро");
  assert(
    r2.action === "create_visual" || r2.action === "create_text_poster",
    "expected visual action for 'сделай картинку доброе утро'"
  );

  const r3 = route(service, "сделай фото с надписью пейте воду");
  assert(r3.action === "create_visual", "expected create_visual for text-on-image request");

  const r4 = route(service, "сделай визуал без фото");
  assert(r4.action === "create_text_poster", "expected create_text_poster for no-photo visual request");

  const r5 = route(service, "создай реалистичную картинку современной клиники");
  assert(r5.action === "generate_ai_image", "expected generate_ai_image for realistic visual request");

  const r6 = route(service, "посмотри конкурента @abc");
  assert(r6.action === "analyze_competitor", "expected analyze_competitor");

  const r7 = route(service, "добавь больше текста на картинку", true);
  assert(r7.action === "edit_current_draft", "expected edit_current_draft with active draft");

  const r8 = route(service, "публикуй");
  assert(r8.action === "publish_intent", "expected publish_intent");

  const r9 = route(service, "сделай пост сам");
  assert(r9.action === "create_visual", "expected create_visual for 'сделай пост сам'");

  const r10 = route(service, "сделай контент план на неделю");
  assert(r10.action === "create_content_plan", "expected content plan action");

  console.log("test:agent-router passed");
}

main().catch((error) => {
  console.error(`test:agent-router failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

