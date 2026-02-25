import { Inject, Injectable, Logger } from '@nestjs/common';
import { CircuitBreakerService } from '../../common/circuit-breaker/circuit-breaker.service';
import type { HttpClient } from '../../common/interfaces/http-client.interface';
import {
  EvaluateWritingSectionInput,
  IeltsWritingMajorError,
  IeltsWritingResult,
  IeltsWritingScores,
  IeltsWritingTaskType,
} from './ielts-writing.types';

interface ResponsesInputText {
  type: 'input_text';
  text: string;
}

interface ResponsesInputImage {
  type: 'input_image';
  image_url: string;
}

type ResponsesInputContent = ResponsesInputText | ResponsesInputImage;

interface OpenAIResponsesResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

interface OpenAIRequestError extends Error {
  response?: {
    status?: number;
    data?: unknown;
  };
  status?: number;
}

const SYSTEM_PROMPT = `You are a certified IELTS Academic Writing examiner.
Assess strictly using official IELTS band descriptors.
Do NOT be generous.
Use half-band scoring.
Return ONLY valid JSON.`;

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const DEFAULT_BACKEND_URL = process.env.BACKEND_URL?.trim() || '';

const clampBand = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const rounded = Math.round(parsed * 2) / 2;
  return Math.min(9, Math.max(0, rounded));
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
};

const toSafeText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

const toMajorErrors = (value: unknown): IeltsWritingMajorError[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        original: toSafeText(item.original),
        correction: toSafeText(item.correction),
        reason: toSafeText(item.reason),
      };
    })
    .filter(
      (entry) =>
        entry.original.length > 0 ||
        entry.correction.length > 0 ||
        entry.reason.length > 0,
    );
};

const buildTaskContent = (
  input: EvaluateWritingSectionInput,
): ResponsesInputContent[] => {
  if (input.taskType === 'task1') {
    const resolvedImageUrl = resolveImageUrl(input.imageUrl);
    const content: ResponsesInputContent[] = [
      {
        type: 'input_text',
        text: 'Evaluate IELTS Academic Writing Task 1.',
      },
      {
        type: 'input_text',
        text: `Instruction: ${input.instruction || 'N/A'}`,
      },
    ];

    if (resolvedImageUrl && isPublicImageUrl(resolvedImageUrl)) {
      content.push({
        type: 'input_image',
        image_url: resolvedImageUrl,
      });
    } else {
      content.push({
        type: 'input_text',
        text: `Image URL: ${resolvedImageUrl || 'N/A'}`,
      });
    }

    content.push(
      {
        type: 'input_text',
        text: `Candidate answer: ${input.essay}`,
      },
      {
        type: 'input_text',
        text: `Word count: ${input.wordCount}`,
      },
    );

    return content;
  }

  return [
    {
      type: 'input_text',
      text: 'Evaluate IELTS Academic Writing Task 2.',
    },
    {
      type: 'input_text',
      text: `Question: ${input.question || 'N/A'}`,
    },
    {
      type: 'input_text',
      text: `Candidate answer: ${input.essay}`,
    },
    {
      type: 'input_text',
      text: `Word count: ${input.wordCount}`,
    },
  ];
};

const extractOutputText = (response: OpenAIResponsesResponse): string => {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const fallbackText = response.output
    ?.flatMap((outputItem) => outputItem.content || [])
    .map((contentItem) => contentItem.text || '')
    .join('\n')
    .trim();

  return fallbackText || '';
};

const resolveImageUrl = (imageUrl?: string): string | null => {
  const raw = imageUrl?.trim();
  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (!DEFAULT_BACKEND_URL) {
    return null;
  }

  const normalizedBase = DEFAULT_BACKEND_URL.replace(/\/$/, '');
  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
  return `${normalizedBase}${normalizedPath}`;
};

const isPublicImageUrl = (imageUrl: string): boolean => {
  try {
    const parsed = new URL(imageUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    ) {
      return false;
    }

    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

const getHttpStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const typed = error as OpenAIRequestError;
  return typed.response?.status || typed.status || null;
};

const getHttpErrorDetails = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const typed = error as OpenAIRequestError;
  const status = getHttpStatus(error);
  const payload = typed.response?.data;

  if (!status) {
    return error.message;
  }

  if (payload && typeof payload === 'object') {
    try {
      return `status ${status} - ${JSON.stringify(payload)}`;
    } catch {
      return `status ${status} - ${error.message}`;
    }
  }

  return `status ${status} - ${error.message}`;
};

const extractJsonObjectText = (rawText: string): string => {
  const text = rawText.trim();
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const withoutBlock = blockMatch ? blockMatch[1].trim() : text;

  const objectMatch = withoutBlock.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : withoutBlock;
};

const hasWordCountPenalty = (
  taskType: IeltsWritingTaskType,
  wordCount: number,
): boolean => {
  if (taskType === 'task1') {
    return wordCount < 150;
  }

  return wordCount < 250;
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnaborted') ||
    message.includes('etimedout')
  );
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly circuitBreaker: CircuitBreakerService;
  private readonly openAiApiKey: string;
  private readonly openAiModel: string;
  private readonly evaluationTimeoutMs = Number(
    process.env.AI_EVALUATION_TIMEOUT_MS ?? 45000,
  );

  constructor(
    @Inject('HttpClient')
    private readonly httpClient: HttpClient,
  ) {
    this.openAiApiKey = process.env.OPENAI_API_KEY?.trim() || '';
    this.openAiModel = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

    if (!this.openAiApiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured. Writing AI evaluation will fail.',
      );
    }

    this.circuitBreaker = new CircuitBreakerService({
      failureThreshold: 5,
      timeoutDuration: 60000,
      successThreshold: 3,
    });
  }

  async evaluateWritingSection(
    input: EvaluateWritingSectionInput,
  ): Promise<IeltsWritingResult> {
    if (!this.openAiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const normalizedEssay = input.essay?.trim() || '';
    if (!normalizedEssay) {
      throw new Error('Candidate essay is empty');
    }

    const normalizedWordCount = Number.isFinite(input.wordCount)
      ? Math.max(0, Math.floor(input.wordCount))
      : normalizedEssay.split(/\s+/).filter(Boolean).length;

    const normalizedInput: EvaluateWritingSectionInput = {
      ...input,
      essay: normalizedEssay,
      wordCount: normalizedWordCount,
    };

    return this.circuitBreaker.execute(async () => {
      try {
        let response: OpenAIResponsesResponse;

        try {
          response = await this.requestResponsesApi(normalizedInput, true);
        } catch (firstError) {
          const status = getHttpStatus(firstError);
          if (status !== 400) {
            throw firstError;
          }

          this.logger.warn(
            `OpenAI /responses rejected response_format payload (${getHttpErrorDetails(firstError)}), retrying with text.format`,
          );
          response = await this.requestResponsesApi(normalizedInput, false);
        }

        const outputText = extractOutputText(response);
        if (!outputText) {
          throw new Error('OpenAI Responses API returned empty output_text');
        }

        return this.parseResult(outputText, normalizedInput);
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new Error(
            `RETRYABLE_TIMEOUT: OpenAI Responses API timeout after ${this.evaluationTimeoutMs}ms`,
          );
        }

        throw new Error(`OpenAI request failed: ${getHttpErrorDetails(error)}`);
      }
    });
  }

  private async requestResponsesApi(
    input: EvaluateWritingSectionInput,
    useLegacyResponseFormat: boolean,
  ): Promise<OpenAIResponsesResponse> {
    const baseBody = {
      model: this.openAiModel,
      max_output_tokens: 1200,
      temperature: 0.1,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: SYSTEM_PROMPT,
            },
          ],
        },
        {
          role: 'user',
          content: buildTaskContent(input),
        },
      ],
    };

    const requestBody = useLegacyResponseFormat
      ? {
          ...baseBody,
          response_format: { type: 'json_object' },
        }
      : {
          ...baseBody,
          text: {
            format: { type: 'json_object' },
          },
        };

    return this.httpClient.post<OpenAIResponsesResponse>(
      'https://api.openai.com/v1/responses',
      requestBody,
      {
        Authorization: `Bearer ${this.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
    );
  }

  private parseResult(
    rawText: string,
    input: EvaluateWritingSectionInput,
  ): IeltsWritingResult {
    try {
      const jsonText = extractJsonObjectText(rawText);
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;

      const parsedScores =
        parsed.scores && typeof parsed.scores === 'object'
          ? (parsed.scores as Record<string, unknown>)
          : {};

      const scores: IeltsWritingScores = {
        task_achievement: clampBand(parsedScores.task_achievement),
        coherence_cohesion: clampBand(parsedScores.coherence_cohesion),
        lexical_resource: clampBand(parsedScores.lexical_resource),
        grammar: clampBand(parsedScores.grammar),
      };

      const modelTaskType =
        parsed.task_type === 'task1' || parsed.task_type === 'task2'
          ? (parsed.task_type as IeltsWritingTaskType)
          : input.taskType;

      const averageBand =
        (scores.task_achievement +
          scores.coherence_cohesion +
          scores.lexical_resource +
          scores.grammar) /
        4;

      const overallBandRaw =
        typeof parsed.overall_band === 'number'
          ? parsed.overall_band
          : averageBand;

      const forcedPenalty = hasWordCountPenalty(
        input.taskType,
        input.wordCount,
      );

      return {
        task_type: modelTaskType,
        scores,
        overall_band: clampBand(overallBandRaw),
        word_count_penalty:
          forcedPenalty ||
          Boolean(
            parsed.word_count_penalty === true ||
            parsed.word_count_penalty === 'true',
          ),
        strengths: toStringArray(parsed.strengths),
        weaknesses: toStringArray(parsed.weaknesses),
        major_errors: toMajorErrors(parsed.major_errors),
        band_improvement_advice: toStringArray(parsed.band_improvement_advice),
      };
    } catch (error) {
      this.logger.error('Failed to parse OpenAI writing evaluation JSON');
      throw new Error(
        `Invalid AI JSON response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getCircuitBreakerHealth() {
    return this.circuitBreaker.getMetrics();
  }

  getEvaluationTimeoutMs() {
    return this.evaluationTimeoutMs;
  }
}
