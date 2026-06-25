'use client';

import { AnswerValue } from '@/features/exam/types';
import { useExamStore } from '@/store';
import { useCallback, useState } from 'react';

interface UseExamAnswersOptions {
  syncAnswers: (answers: Record<string, unknown>) => Promise<void>;
}

export function useExamAnswers({ syncAnswers }: UseExamAnswersOptions) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});

  const resetAnswers = useCallback(() => {
    setAnswers({});
  }, []);

  const applyAnswers = useCallback((nextAnswers: Record<string, AnswerValue>) => {
    setAnswers(nextAnswers);
  }, []);

  const updateAnswer = useCallback(
    (questionId: string, value: AnswerValue) => {
      useExamStore.getState().setAnswer(questionId, value);
      setAnswers((previous) => ({ ...previous, [questionId]: value }));
      void syncAnswers({ [questionId]: value });
    },
    [syncAnswers],
  );

  return {
    answers,
    setAnswers: applyAnswers,
    resetAnswers,
    updateAnswer,
  };
}
