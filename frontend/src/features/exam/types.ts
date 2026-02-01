import { Passage as BasePassage, Question } from '@/types';

export type AnswerValue = string | string[] | Record<string, string>;

export interface ExamPartQuestion {
  id: string;
  number: string | number;
  isAnswered: boolean;
}

export interface ExamPart {
  number: number;
  questionCount: number;
  answeredCount: number;
  startQuestionNumber: number;
  questions: ExamPartQuestion[];
}

export type Passage = BasePassage;

export type QuestionList = Question[];
