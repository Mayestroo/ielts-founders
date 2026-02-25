import { EvaluateWritingSectionInput } from '../ai/ielts-writing.types';

export interface WritingGradingJobData {
  submissionId: string;
  resultId: string;
  tasks: EvaluateWritingSectionInput[];
}

export interface WritingGradingResult {
  success: boolean;
  bandScore?: number;
  error?: string;
}
