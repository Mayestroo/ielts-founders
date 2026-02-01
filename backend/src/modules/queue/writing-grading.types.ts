export interface WritingGradingJobData {
  submissionId: string;
  resultId: string;
  tasks: WritingTask[];
}

export interface WritingTask {
  id: string;
  description: string;
  response: string;
}

export interface WritingGradingResult {
  success: boolean;
  bandScore?: number;
  error?: string;
}
