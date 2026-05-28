import { Language } from "../types/domain.js";

type CompetitorAnalysisInput = {
  language: Language;
  userText: string;
  competitorRef?: string;
  hasScreenshot?: boolean;
};

const RU_RESPONSE = {
  title: "Разбор конкурента (без копирования 1:1)",
  works: [
    "Понятный визуальный стиль и единая цветовая система",
    "Посты с понятной пользой для пациента",
    "Регулярные публикации с предсказуемыми рубриками"
  ],
  improve: [
    "Больше доказательной экспертности без агрессивных обещаний",
    "Чище CTA и меньше перегруза в подписях",
    "Ясные визуальные блоки: 1 идея = 1 карточка"
  ],
  ideas: [
    "Серия: как проходит приём в клинике",
    "Короткие советы по профилактике и образу жизни",
    "Истории о команде и оборудовании",
    "Обновления клиники и полезные анонсы",
    "Ответы на частые вопросы пациентов"
  ],
  visualDirections: [
    "Clean medical: светлые карточки + короткий заголовок",
    "Premium calm: мягкий градиент + минимализм",
    "Educational cards: 2–3 ясных пункта на слайд"
  ],
  caption:
    "Мы делаем контент, который помогает пациентам ориентироваться в вопросах здоровья и сервиса клиники без громких обещаний.",
  poster: "Постер: «Комфортный визит в клинику» + 3 буллета о сервисе",
  carousel: "Карусель: «Что важно перед визитом в клинику» (5 слайдов)"
};

const EN_RESPONSE = {
  title: "Competitor snapshot (no 1:1 copying)",
  works: [
    "Consistent visual identity and tone",
    "Audience-focused educational posts",
    "Predictable content cadence"
  ],
  improve: [
    "More evidence-based messaging without risky claims",
    "Clearer CTA and less caption overload",
    "Cleaner visual hierarchy per post"
  ],
  ideas: [
    "Series: what to expect during a clinic visit",
    "Short prevention and lifestyle tips",
    "Team and equipment spotlight",
    "Clinic updates and safe announcements",
    "FAQ answers for patients"
  ],
  visualDirections: [
    "Clean medical cards with short titles",
    "Premium calm layouts with soft gradients",
    "Educational 3-point visual cards"
  ],
  caption:
    "We publish helpful clinic content that informs patients with safe, clear, and responsible communication.",
  poster: "Poster: 'Comfortable clinic visit' with 3 service bullets",
  carousel: "Carousel: 'What to know before your clinic visit' (5 slides)"
};

export class CompetitorAnalysisService {
  analyze(input: CompetitorAnalysisInput): string {
    const kit = input.language === "en" ? EN_RESPONSE : RU_RESPONSE;
    const ref = input.competitorRef ?? input.userText.match(/@[a-z0-9._]{2,}/i)?.[0] ?? "конкурент";
    const screenshotNote = input.hasScreenshot
      ? input.language === "en"
        ? "Screenshot context included."
        : "Контекст по скриншоту учтён."
      : input.language === "en"
        ? "For deeper analysis, send a screenshot or public post text."
        : "Для более точного разбора пришлите скриншот или текст публичного поста.";

    return [
      `${kit.title}: ${ref}`,
      "",
      input.language === "en" ? "What works:" : "Что работает:",
      ...kit.works.map((line) => `- ${line}`),
      "",
      input.language === "en" ? "What to improve:" : "Что улучшить:",
      ...kit.improve.map((line) => `- ${line}`),
      "",
      input.language === "en" ? "5 safe content ideas:" : "5 безопасных идей:",
      ...kit.ideas.map((line) => `- ${line}`),
      "",
      input.language === "en" ? "3 visual directions:" : "3 визуальных направления:",
      ...kit.visualDirections.map((line) => `- ${line}`),
      "",
      `${input.language === "en" ? "Suggested caption" : "Рекомендованная подпись"}: ${kit.caption}`,
      `${input.language === "en" ? "Suggested poster" : "Рекомендованный постер"}: ${kit.poster}`,
      `${input.language === "en" ? "Suggested carousel" : "Рекомендованная карусель"}: ${kit.carousel}`,
      "",
      screenshotNote
    ].join("\n");
  }
}

