import { AiService } from '../ai/ai.service';
import {
  EvaluateWritingSectionInput,
  IeltsWritingResult,
  IeltsWritingScores,
  IeltsWritingSectionResult,
} from '../ai/ielts-writing.types';

export type WritingTaskResults = Partial<
  Record<'task1' | 'task2', IeltsWritingResult>
>;

const roundBand = (value: number): number => Math.round(value * 2) / 2;

const emptyScores = (): IeltsWritingScores => ({
  task_achievement: 0,
  coherence_cohesion: 0,
  lexical_resource: 0,
  grammar: 0,
});

export const buildWritingSectionResult = (
  taskResults: WritingTaskResults,
): IeltsWritingSectionResult => {
  const weights: Record<'task1' | 'task2', number> = {
    task1: 1,
    task2: 2,
  };

  const available = (['task1', 'task2'] as const).filter((taskType) =>
    Boolean(taskResults[taskType]),
  );

  if (available.length === 0) {
    throw new Error('No writing task evaluations available');
  }

  const totalWeight = available.reduce(
    (sum, taskType) => sum + weights[taskType],
    0,
  );

  const weightedScores = available.reduce((acc, taskType) => {
    const result = taskResults[taskType]!;
    const weight = weights[taskType];

    return {
      task_achievement:
        acc.task_achievement + result.scores.task_achievement * weight,
      coherence_cohesion:
        acc.coherence_cohesion + result.scores.coherence_cohesion * weight,
      lexical_resource:
        acc.lexical_resource + result.scores.lexical_resource * weight,
      grammar: acc.grammar + result.scores.grammar * weight,
    };
  }, emptyScores());

  const normalizedScores: IeltsWritingScores = {
    task_achievement: roundBand(weightedScores.task_achievement / totalWeight),
    coherence_cohesion: roundBand(
      weightedScores.coherence_cohesion / totalWeight,
    ),
    lexical_resource: roundBand(weightedScores.lexical_resource / totalWeight),
    grammar: roundBand(weightedScores.grammar / totalWeight),
  };

  const weightedBand = roundBand(
    available.reduce(
      (sum, taskType) =>
        sum + taskResults[taskType]!.overall_band * weights[taskType],
      0,
    ) / totalWeight,
  );

  return {
    overall_band: weightedBand,
    word_count_penalty: available.some(
      (taskType) => taskResults[taskType]!.word_count_penalty,
    ),
    task1: taskResults.task1,
    task2: taskResults.task2,
    weighted_scores: normalizedScores,
  };
};

export const evaluateWritingTaskInputs = async (
  aiService: AiService,
  taskInputs: EvaluateWritingSectionInput[],
): Promise<WritingTaskResults> => {
  const result: WritingTaskResults = {};

  for (const taskInput of taskInputs) {
    if (!taskInput.essay.trim()) {
      continue;
    }

    result[taskInput.taskType] =
      await aiService.evaluateWritingSection(taskInput);
  }

  return result;
};
