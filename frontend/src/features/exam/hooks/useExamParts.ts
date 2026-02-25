import {
  getListeningPartForQuestion,
  getListeningQuestionNumber,
} from '@/lib/listeningAudio';
import { Question } from '@/types';
import { useMemo } from 'react';
import { AnswerValue, ExamPart, Passage } from '../types';
import { getEffectivePoints } from '../utils';

const resolveWritingTaskNumber = (
  question: Question,
  fallbackNumber: number,
): number => {
  if (typeof question.number === 'number' && Number.isFinite(question.number)) {
    const rounded = Math.floor(question.number);
    if (rounded >= 1) {
      return rounded;
    }
  }

  const normalizedId = question.id.trim().toLowerCase();
  const directMatch = normalizedId.match(/^(?:w|task)(\d+)$/);
  if (directMatch) {
    const parsed = Number.parseInt(directMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  const fallbackDigits = normalizedId.match(/\d+/);
  if (fallbackDigits) {
    const parsed = Number.parseInt(fallbackDigits[0], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 2) {
      return parsed;
    }
  }

  return fallbackNumber;
};

interface UseExamPartsArgs {
  section:
    | {
        type?: string;
        questions?: unknown;
        passages?: unknown;
      }
    | null
    | undefined;
  answers: Record<string, AnswerValue>;
  currentQuestionId: string;
  forcedPartNumber?: number | null;
}

export const useExamParts = ({
  section,
  answers,
  currentQuestionId,
  forcedPartNumber = null,
}: UseExamPartsArgs) => {
  const questions = useMemo(
    () => (section?.questions || []) as Question[],
    [section]
  );

  const passages = useMemo(
    () => (section?.passages || []) as Passage[],
    [section]
  );

  const parts = useMemo<ExamPart[]>(() => {
    if (!section?.type) return [];

    let generatedParts: ExamPart[] = [];

    if (section.type === 'READING') {
      let globalIndex = 0;
      generatedParts = passages.map((passage, index) => {
        const partQuestions = questions.filter(
          (question) => question.passageId === passage.id
        );

        const totalPoints = partQuestions.reduce(
          (sum, question) => sum + getEffectivePoints(question),
          0
        );

        const answeredCount = partQuestions.reduce((sum, question) => {
          const answer = answers[question.id];
          const points = getEffectivePoints(question);
          if (question.type === 'MCQ_MULTIPLE' && Array.isArray(answer)) {
            return sum + Math.min(answer.length, points);
          }
          return sum + (answer ? points : 0);
        }, 0);

        const firstMatch = partQuestions[0]?.id.match(/\d+/);
        const startNum = firstMatch ? parseInt(firstMatch[0]) : globalIndex + 1;

        const navQuestions = partQuestions.map((question) => {
          const match = question.id.match(/\d+/);
          const start = match ? parseInt(match[0]) : questions.indexOf(question) + 1;
          const points = getEffectivePoints(question);
          const displayLabel =
            points > 1 ? `${start}-${start + points - 1}` : start;

          return {
            id: question.id,
            number: displayLabel,
            isAnswered: Array.isArray(answers[question.id])
              ? (answers[question.id] as string[]).length > 0
              : !!answers[question.id],
          };
        });

        globalIndex += partQuestions.length;

        return {
          number: index + 1,
          questionCount: totalPoints,
          answeredCount,
          startQuestionNumber: startNum,
          questions: navQuestions,
        };
      });
    } else if (section.type === 'WRITING') {
      generatedParts = questions
        .map((question, index) => {
          const taskNumber = resolveWritingTaskNumber(question, index + 1);

          return {
            number: taskNumber,
            questionCount: 1,
            answeredCount: answers[question.id] ? 1 : 0,
            startQuestionNumber: taskNumber,
            questions: [
              {
                id: question.id,
                number: `Task ${taskNumber}`,
                isAnswered: !!answers[question.id],
              },
            ],
          };
        })
        .sort((left, right) => left.number - right.number);
    } else {
      const partRanges = [
        { start: 1, end: 10 },
        { start: 11, end: 20 },
        { start: 21, end: 30 },
        { start: 31, end: 40 },
      ];

      generatedParts = partRanges.map((range, index) => {
        const partNumber = (index + 1) as 1 | 2 | 3 | 4;
        const partQuestions = questions.filter(
          (question) => getListeningPartForQuestion(question) === partNumber
        );

        if (partQuestions.length === 0) {
          return {
            number: index + 1,
            questionCount: 0,
            answeredCount: 0,
            startQuestionNumber: range.start,
            questions: [],
          };
        }

        const answeredCount = partQuestions.reduce((sum, question) => {
          const answer = answers[question.id];
          const points = getEffectivePoints(question);
          if (question.type === 'MCQ_MULTIPLE' && Array.isArray(answer)) {
            return sum + Math.min(answer.length, points);
          }
          return sum + (answer ? points : 0);
        }, 0);

        const totalPoints = partQuestions.reduce(
          (sum, question) => sum + getEffectivePoints(question),
          0
        );

        const navQuestions = partQuestions.map((question) => {
          const start = getListeningQuestionNumber(question) || 0;
          const points = getEffectivePoints(question);
          const displayLabel =
            points > 1 ? `${start}-${start + points - 1}` : start;

          return {
            id: question.id,
            number: displayLabel,
            isAnswered: Array.isArray(answers[question.id])
              ? (answers[question.id] as string[]).length > 0
              : !!answers[question.id],
          };
        });

        return {
          number: index + 1,
          questionCount: totalPoints,
          answeredCount,
          startQuestionNumber: range.start,
          questions: navQuestions,
        };
      });
    }
    
    let visibleParts = generatedParts.filter((part) => part.questionCount > 0);

    if (forcedPartNumber && visibleParts.length > 0) {
      // For split routes (/exam/{id}-part-{n} or /exam/{id}-task-{n}),
      // the filtered section may contain only one visible part/task.
      // Keep the displayed number aligned with the route segment.
      visibleParts = visibleParts.map((part, index) =>
        index === 0
          ? {
              ...part,
              number: forcedPartNumber,
              questions:
                section.type === 'WRITING'
                  ? part.questions.map((question) => ({
                      ...question,
                      number: `Task ${forcedPartNumber}`,
                    }))
                  : part.questions,
            }
          : part,
      );
    }

    return visibleParts;
  }, [answers, forcedPartNumber, passages, questions, section]);

  const currentPartNumber = useMemo(() => {
    if (!currentQuestionId) return parts[0]?.number ?? 1;
    const part = parts.find((currentPart) =>
      currentPart.questions.some((question) => question.id === currentQuestionId)
    );
    return part ? part.number : (parts[0]?.number ?? 1);
  }, [currentQuestionId, parts]);

  const activePartIndex = useMemo(
    () => parts.findIndex((part) => part.number === currentPartNumber),
    [parts, currentPartNumber]
  );

  const currentPart = useMemo(
    () => (activePartIndex >= 0 ? parts[activePartIndex] : parts[0]),
    [activePartIndex, parts]
  );

  const startQuestion = currentPart?.startQuestionNumber || 1;
  const endQuestion =
    startQuestion + (currentPart?.questionCount || 1) - 1;

  return {
    parts,
    currentPartNumber,
    activePartIndex,
    currentPart,
    startQuestion,
    endQuestion,
  };
};
