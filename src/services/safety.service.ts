import { SafetyResult } from "../types/domain.js";

const RISK_TERMS = [
  "гарантированно",
  "100%",
  "без риска",
  "полностью вылечит",
  "лучший метод",
  "моментальное излечение",
  "guaranteed",
  "100 percent",
  "risk-free",
  "fully cure",
  "best treatment"
];

const DIAGNOSIS_TERMS = [
  "вам точно подходит",
  "у вас диагноз",
  "you definitely have",
  "this diagnoses you"
];

const DANGEROUS_ADVICE_TERMS = [
  "прекратите лекарства",
  "отмените препараты",
  "skip your medication",
  "stop prescribed medication"
];

export class SafetyService {
  analyzeText(rawText: string): SafetyResult {
    const text = rawText.toLowerCase();
    const blockedTerms = RISK_TERMS.filter((term) => text.includes(term));
    const diagnosisFlags = DIAGNOSIS_TERMS.filter((term) => text.includes(term));
    const dangerousAdviceFlags = DANGEROUS_ADVICE_TERMS.filter((term) => text.includes(term));

    const hasUnsafeClaims =
      blockedTerms.length > 0 || diagnosisFlags.length > 0 || dangerousAdviceFlags.length > 0;

    if (!hasUnsafeClaims) {
      return { blockedTerms: [], hasUnsafeClaims: false };
    }

    const allTerms = [...blockedTerms, ...diagnosisFlags, ...dangerousAdviceFlags];
    const saferTextSuggestion =
      "Используйте нейтральную формулировку: опишите симптомы, профилактику и необходимость очной консультации у врача.";

    return {
      blockedTerms: allTerms,
      hasUnsafeClaims: true,
      warningMessage:
        "Обнаружены потенциально рискованные медицинские формулировки. Уберите обещания результата, диагнозы и опасные советы.",
      saferTextSuggestion
    };
  }

  ensureMedicalDisclaimer(text: string, language: "ru" | "en"): string {
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

    const disclaimer = language === "ru" ? ruDisclaimer : enDisclaimer;
    return `${text}\n\n${disclaimer}`;
  }
}
