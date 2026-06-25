import { EvaluateWritingSectionInput } from '../ai/ielts-writing.types';

export interface SpeakingPartEvaluationInput {
  partNumber: number;
  questionId: string;
  prompt: string;
  audioUrl: string;
  audioDurationSeconds?: number;
}

export class WritingSubmittedEvent {
  constructor(
    public readonly submissionId: string,
    public readonly resultId: string,
    public readonly studentId: string,
    public readonly sectionId: string,
    public readonly tasks: EvaluateWritingSectionInput[],
  ) {}
}

export class WritingGradedEvent {
  constructor(
    public readonly submissionId: string,
    public readonly resultId: string,
    public readonly studentId: string,
    public readonly bandScore: number,
    public readonly evaluation: unknown,
  ) {}
}

export class WritingGradingFailedEvent {
  constructor(
    public readonly submissionId: string,
    public readonly resultId: string,
    public readonly studentId: string,
    public readonly error: string,
    public readonly attemptsMade: number,
    public readonly maxAttempts: number,
  ) {}
}

export class SpeakingSubmittedEvent {
  constructor(
    public readonly assignmentId: string,
    public readonly resultId: string,
    public readonly studentId: string,
    public readonly sectionId: string,
    public readonly parts: SpeakingPartEvaluationInput[],
  ) {}
}

export class ExamStartedEvent {
  constructor(
    public readonly assignmentId: string,
    public readonly studentId: string,
    public readonly sectionId: string,
    public readonly startTime: Date,
    public readonly endTime: Date,
  ) {}
}

export class ExamSubmittedEvent {
  constructor(
    public readonly assignmentId: string,
    public readonly studentId: string,
    public readonly sectionId: string,
    public readonly sectionType: string,
    public readonly score: number | null,
    public readonly resultId: string | null,
  ) {}
}
