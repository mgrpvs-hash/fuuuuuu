import { formatInstagramCaption } from "../services/caption-formatter.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runPostCaptionAssertions(): void {
  const result = formatInstagramCaption({
    selectedCaption: "Option 1: Клиника использует современное оборудование для точной диагностики.",
    cta: "Запишитесь на консультацию в Direct.",
    hashtags: ["#mcclinic", "здоровье", "#медицина", "#mcclinic", "#терапия", "#health", "#clinic", "#care", "#diagnostics", "#doctor", "#wellness", "#medical", "#tips", "#community"],
    contentType: "post"
  });

  assert(!result.caption.includes("Option 1"), "Caption should not include option labels");
  assert(!result.caption.toLowerCase().includes("story_text"), "Caption should not include story text");
  assert(result.caption.includes("Запишитесь на консультацию"), "Caption should contain CTA");
  assert(result.caption.includes("#mcclinic"), "Caption should contain hashtags");
  assert(result.caption.includes("#здоровье"), "Hashtags should be normalized with #");

  const hashtags = result.caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  assert(hashtags.length <= 12, "Caption should not exceed max hashtags");
  assert(result.caption.endsWith(hashtags[hashtags.length - 1] ?? ""), "Hashtags should be at the end");
}

function runLengthAssertions(): void {
  const veryLongCaption = `${"Очень длинный текст ".repeat(250)}конец`;
  const result = formatInstagramCaption({
    selectedCaption: veryLongCaption,
    cta: "Свяжитесь с нами.",
    hashtags: ["#mcclinic", "#health", "#care", "#clinic", "#diagnostics", "#doctor", "#wellness", "#medical"],
    contentType: "post",
    maxLength: 700
  });

  assert(result.wasTrimmed, "Long caption must be trimmed");
  assert(result.warning === "Caption был сокращён для Instagram.", "Trim warning must be present");
  assert(result.caption.length <= 700, "Caption must respect maxLength");
  assert(result.caption.includes("#mcclinic"), "Trimmed caption must keep hashtags");
}

function runSafetyAssertions(): void {
  const result = formatInstagramCaption({
    selectedCaption: "Мы гарантируем 100% результат и полностью вылечим без риска",
    cta: "Запишитесь на консультацию",
    hashtags: ["#clinic", "#health", "#care", "#mcclinic", "#diagnostics", "#doctor", "#wellness", "#medical"],
    contentType: "post"
  });
  assert(!/100%|гарант|без риска|полностью вылеч/i.test(result.caption), "Risky claims should be removed");
}

function main(): void {
  runPostCaptionAssertions();
  runLengthAssertions();
  runSafetyAssertions();
  console.log("test:caption-format passed");
}

try {
  main();
} catch (error) {
  console.error(`test:caption-format failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

