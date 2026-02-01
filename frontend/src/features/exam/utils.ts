import { Question } from '@/types';

export const getEffectivePoints = (question: Question): number => {
  if (question.points > 1) return question.points;

  if (question.type === 'MCQ_MULTIPLE') {
    if (question.questionRange) {
      const rangeMatch = question.questionRange.match(
        /(\d+)\s*[\u2013-]\s*(\d+)/
      );
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        return Math.max(1, end - start + 1);
      }
    }

    if (question.instruction) {
      const instruction = question.instruction.toUpperCase();
      if (instruction.includes('TWO')) return 2;
      if (instruction.includes('THREE')) return 3;
      if (instruction.includes('FOUR')) return 4;
      if (instruction.includes('FIVE')) return 5;
    }
  }

  return question.points || 1;
};
