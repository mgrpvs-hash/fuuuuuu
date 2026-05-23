import { SafetyResult } from "../types/domain.js";
import { AppError } from "../types/errors.js";

const HIGH_RISK_PATTERNS = [
  /гарант\w*/i,
  /\b100\s?%/i,
  /без\s+риска/i,
  /полностью\s+вылеч\w*/i,
  /моментальн\w+\s+излеч\w*/i,
  /guarantee(d)?/i,
  /risk[-\s]?free/i,
  /fully\s+cure/i
];

const DIAGNOSIS_PATTERNS = [
  /у\s+вас\s+диагноз/i,
  /вы\s+точно\s+болеете/i,
  /this\s+diagnoses\s+you/i,
  /you\s+definitely\s+have/i
];

const DANGEROUS_ADVICE_PATTERNS = [
  /прекратит[еь]\s+лекарств\w*/i,
  /отменит[еь]\s+препарат\w*/i,
  /stop\s+prescribed\s+medication/i,
  /skip\s+your\s+medication/i
];

const AGGRESSIVE_AD_PATTERNS = [
  /лучший\s+метод/i,
  /единственн\w+\s+правильн\w+\s+лечени\w*/i,
  /best\s+treatment/i,
  /only\s+real\s+solution/i
];

const MEDICAL_ADVICE_PATTERNS = [
  /лечение/i,
  /терап\w*/i,
  /препарат/i,
  /симптом/i,
  /диагноз/i,
  /treatment/i,
  /therapy/i,
  /medication/i,
  /symptom/i,
  /diagnosis/i
];

function collectMatches(patterns: RegExp[], text: string): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      matches.push(match[0]);
    }
  }
  return Array.from(new Set(matches));
}

export class SafetyService {
  analyzeText(rawText: string): SafetyResult {
    const text = rawText.trim();
    if (!text) {
      return { blockedTerms: [], hasUnsafeClaims: false };
    }

    const highRisk = collectMatches(HIGH_RISK_PATTERNS, text);
    const diagnosis = collectMatches(DIAGNOSIS_PATTERNS, text);
    const dangerousAdvice = collectMatches(DANGEROUS_ADVICE_PATTERNS, text);
    const aggressiveAds = collectMatches(AGGRESSIVE_AD_PATTERNS, text);
    const all = [...highRisk, ...diagnosis, ...dangerousAdvice, ...aggressiveAds];

    if (all.length === 0) {
      return { blockedTerms: [], hasUnsafeClaims: false };
    }

    return {
      blockedTerms: all,
      hasUnsafeClaims: true,
      warningMessage:
        "Обнаружены рискованные медицинские формулировки. Уберите обещания результата, диагнозы без врача и опасные советы.",
      saferTextSuggestion:
        "Сделайте формулировку нейтральной: факты, профилактика, возможные варианты лечения и рекомендация очной консультации у лицензированного врача."
    };
  }

  requiresMedicalDisclaimer(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }
    return MEDICAL_ADVICE_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  ensureMedicalDisclaimer(text: string, language: "ru" | "en"): string {
    if (!this.requiresMedicalDisclaimer(text)) {
      return text;
    }

    const ruDisclaimer =
      "Информация носит ознакомительный характер и не заменяет консультацию специалиста.";
    const enDisclaimer =
      "This information is for educational purposes only and does not replace consultation with a licensed clinician.";

    const normalized = text.toLowerCase();
    const hasRu = normalized.includes("ознакомительный характер");
    const hasEn = normalized.includes("educational purposes only");
    if (hasRu || hasEn) {
      return text;
    }
    return `${text}\n\n${language === "ru" ? ruDisclaimer : enDisclaimer}`;
  }

  assertSafeForPublishing(text: string): void {
    const result = this.analyzeText(text);
    if (!result.hasUnsafeClaims) {
      return;
    }

    throw new AppError("Safety policy violation detected before publishing", {
      code: "SAFETY_VIOLATION",
      statusCode: 400,
      details: {
        blockedTerms: result.blockedTerms,
        warningMessage: result.warningMessage
      }
    });
  }
}
