import { Question } from '@/types';
import { useMemo } from 'react';
import { AnswerValue, ExamPart, Passage } from '../types';
import { getEffectivePoints } from '../utils';

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
}

export const useExamParts = ({
  section,
  answers,
  currentQuestionId,
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
      generatedParts = questions.map((question, index) => ({
        number: index + 1,
        questionCount: 1,
        answeredCount: answers[question.id] ? 1 : 0,
        startQuestionNumber: index + 1,
        questions: [
          {
            id: question.id,
            number: `Task ${index + 1}`,
            isAnswered: !!answers[question.id],
          },
        ],
      }));
    } else {
      const partRanges = [
        { start: 1, end: 10 },
        { start: 11, end: 20 },
        { start: 21, end: 30 },
        { start: 31, end: 40 },
      ];

      generatedParts = partRanges.map((range, index) => {
        const partQuestions = questions.filter((question) => {
          const questionNumber = parseInt(question.id.replace(/\D/g, '')) || 0;
          return questionNumber >= range.start && questionNumber <= range.end;
        });

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
          const match = question.id.match(/\d+/);
          const start = match ? parseInt(match[0]) : 0;
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
    
    return generatedParts.filter(part => part.questionCount > 0);
  }, [answers, passages, questions, section]);

  const currentPartNumber = useMemo(() => {
    if (!currentQuestionId) return 1;
    const part = parts.find((currentPart) =>
      currentPart.questions.some((question) => question.id === currentQuestionId)
    );
    return part ? part.number : 1;
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
