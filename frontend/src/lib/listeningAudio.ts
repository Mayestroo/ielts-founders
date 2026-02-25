import { Question } from "@/types";

export type ListeningPartNumber = 1 | 2 | 3 | 4;

type ListeningQuestionMeta = Question & {
  number?: number;
  partAudioUrl?: string;
  partDurationMinutes?: number;
};

const LISTENING_QUESTIONS_PER_PART = 10;

export const getListeningQuestionNumber = (question: Question): number | null => {
  const explicitNumber = (question as ListeningQuestionMeta).number;
  if (typeof explicitNumber === "number" && Number.isFinite(explicitNumber) && explicitNumber > 0) {
    return explicitNumber;
  }

  const fallback = Number.parseInt(question.id.replace(/\D/g, ""), 10);
  if (!Number.isFinite(fallback) || fallback <= 0) {
    return null;
  }

  return fallback;
};

export const getListeningPartForQuestion = (
  question: Question,
): ListeningPartNumber | null => {
  const number = getListeningQuestionNumber(question);
  if (!number) {
    return null;
  }

  const part = Math.ceil(number / LISTENING_QUESTIONS_PER_PART);
  if (part < 1 || part > 4) {
    return null;
  }

  return part as ListeningPartNumber;
};

export const getListeningPartQuestions = (
  questions: Question[],
  part: ListeningPartNumber,
): Question[] =>
  questions.filter((question) => getListeningPartForQuestion(question) === part);

export const resolveListeningPartAudioUrl = (
  questions: Question[],
  part: ListeningPartNumber,
): string | undefined => {
  for (const question of questions) {
    if (getListeningPartForQuestion(question) !== part) {
      continue;
    }

    const partAudioUrl = (question as ListeningQuestionMeta).partAudioUrl;
    if (typeof partAudioUrl !== "string") {
      continue;
    }

    const trimmed = partAudioUrl.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
};

export const resolveListeningPartDurationMinutes = (
  questions: Question[],
  part: ListeningPartNumber,
  fallbackMinutes = 8,
): number => {
  for (const question of questions) {
    if (getListeningPartForQuestion(question) !== part) {
      continue;
    }

    const rawDuration = (question as ListeningQuestionMeta).partDurationMinutes;
    if (typeof rawDuration !== "number" || !Number.isFinite(rawDuration)) {
      continue;
    }

    const rounded = Math.ceil(rawDuration);
    if (rounded > 0) {
      return rounded;
    }
  }

  return fallbackMinutes;
};
