export type IeltsWritingTaskType = 'task1' | 'task2';

export interface EvaluateWritingSectionInput {
  taskType: IeltsWritingTaskType;
  instruction?: string;
  question?: string;
  imageUrl?: string;
  essay: string;
  wordCount: number;
}

export interface IeltsWritingScores {
  task_achievement: number;
  coherence_cohesion: number;
  lexical_resource: number;
  grammar: number;
}

export interface IeltsWritingMajorError {
  original: string;
  correction: string;
  reason: string;
}

export interface IeltsWritingResult {
  task_type: IeltsWritingTaskType;
  scores: IeltsWritingScores;
  overall_band: number;
  word_count_penalty: boolean;
  off_topic: boolean;
  paragraph_count: number;
  copied_from_question: string[];
  strengths: string[];
  weaknesses: string[];
  major_errors: IeltsWritingMajorError[];
  band_improvement_advice: string[];
}

export interface IeltsWritingSectionResult {
  overall_band: number;
  word_count_penalty: boolean;
  task1?: IeltsWritingResult;
  task2?: IeltsWritingResult;
  weighted_scores: IeltsWritingScores;
}
