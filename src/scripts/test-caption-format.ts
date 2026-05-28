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
    hashtags: ["#mcclinic", "здоровье", "#медицина"],
    contentType: "post"
  });

  assert(!result.caption.includes("Option 1"), "Caption should not include option labels");
  assert(!result.caption.toLowerCase().includes("story_text"), "Caption should not include story text");
  assert(result.caption.includes("Запишитесь на консультацию"), "Caption should contain CTA");
  assert(result.caption.includes("#mcclinic"), "Caption should contain hashtags");
  assert(result.caption.includes("#здоровье"), "Hashtags should be normalized with #");
}

function runLengthAssertions(): void {
  const veryLongCaption = `${"Очень длинный текст ".repeat(250)}конец`;
  const result = formatInstagramCaption({
    selectedCaption: veryLongCaption,
    cta: "Свяжитесь с нами.",
    hashtags: ["#mcclinic", "#health"],
    contentType: "post",
    maxLength: 700
  });

  assert(result.wasTrimmed, "Long caption must be trimmed");
  assert(result.warning === "Caption был сокращён для Instagram.", "Trim warning must be present");
  assert(result.caption.length <= 700, "Caption must respect maxLength");
  assert(result.caption.includes("#mcclinic"), "Trimmed caption must keep hashtags");
}

function main(): void {
  runPostCaptionAssertions();
  runLengthAssertions();
  console.log("test:caption-format passed");
}

try {
  main();
} catch (error) {
  console.error(
    `test:caption-format failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}

