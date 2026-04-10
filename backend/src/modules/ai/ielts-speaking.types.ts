export interface EvaluateSpeakingSectionInput {
  prompt: string;
  transcription: string;
  audioDurationSeconds?: number;
}

export interface IeltsSpeakingScores {
  fluency_coherence: number;
  lexical_resource: number;
  grammatical_range_accuracy: number;
  pronunciation: number;
}

export interface IeltsSpeakingResult {
  scores: IeltsSpeakingScores;
  overall_band: number;
  strengths: string[];
  weaknesses: string[];
  improvement_tips: string[];
  estimated_cefr: string;
}
