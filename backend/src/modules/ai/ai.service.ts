import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CircuitBreakerService } from '../../common/circuit-breaker/circuit-breaker.service';
import type { HttpClient } from '../../common/interfaces/http-client.interface';
import {
  EvaluateWritingSectionInput,
  IeltsWritingMajorError,
  IeltsWritingResult,
  IeltsWritingScores,
  IeltsWritingTaskType,
} from './ielts-writing.types';
import {
  EvaluateSpeakingSectionInput,
  IeltsSpeakingResult,
  IeltsSpeakingScores,
} from './ielts-speaking.types';

interface ResponsesInputText {
  type: 'input_text';
  text: string;
}

interface ResponsesInputImage {
  type: 'input_image';
  image_url: string;
}

type ResponsesInputContent = ResponsesInputText | ResponsesInputImage;

interface ResponseOutputContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface ResponseOutputItem {
  type?: string;
  role?: string;
  status?: string;
  content?: ResponseOutputContent[];
}

interface OpenAIResponsesResponse {
  id?: string;
  status?: string;
  output_text?: string;
  output?: ResponseOutputItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string; code?: string } | null;
}

interface OpenAITranscriptionResponse {
  text?: string;
  transcript?: string;
  output_text?: string;
  segments?: Array<{
    text?: string;
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
Assess strictly using official IELTS Writing Band Descriptors. Do NOT be generous.
Use half-band scoring only (0.0, 0.5, ..., 9.0).

OFFICIAL RATING PRINCIPLES (MUST FOLLOW):
- A script must fully fit the positive features of a band level to receive that level.
- Negative limiting features cap the score. Do not ignore limiting features.
- Score each criterion independently from the descriptor language.
- Responses of 20 words or fewer are Band 1.
- Band 0 is only for: no attempt, response entirely in non-English, or proven fully memorised response.

LANGUAGE POLICY (PLATFORM ENFORCED):
- IELTS Writing responses must be English only.
- If the candidate mixes English with another language OR uses non-English scripts, assign 0.0 for every criterion and overall_band = 0.0.
- Mention the language policy violation clearly in weaknesses and advice.

TASK-SPECIFIC CRITERION

Task 1 - Task Achievement (Academic):
- Band 9: all task requirements fully and appropriately satisfied.
- Band 8: all requirements covered appropriately/relevantly/sufficiently; key features well selected and illustrated; only occasional omissions.
- Band 7: requirements covered; clear overview; key features highlighted, though extension may be incomplete.
- Band 6: requirements addressed with appropriate format; key features adequately covered; relevant overview attempted; some missing/excess/irrelevant detail.
- Band 5: generally addresses task but key features inadequately covered; may focus mechanically on detail; limited extension; possible inappropriate format.
- Band 4: attempt only; few key features selected; key points may be irrelevant/repetitive/inaccurate; format may be inappropriate.
- Band 3: does not address requirements; key features largely irrelevant; very limited/repetitive information.
- Band 2: barely related or fully off-topic; little relevant message.
- Band 1: 20 words or fewer, or wholly unrelated content.
- Band 0: no attempt/non-English throughout/proven memorised answer.

Task 2 - Task Response:
- Band 9: prompt fully addressed in depth; clear fully developed position; relevant, fully extended, well supported ideas.
- Band 8: prompt sufficiently addressed; clear well-developed position; relevant and supported ideas; occasional lapses only.
- Band 7: main parts addressed; clear developed position; ideas extended/supporting detail may occasionally over-generalise or lose precision.
- Band 6: main parts addressed but unevenly; directly relevant position but conclusions may be unclear/repetitive; support sometimes insufficient.
- Band 5: main parts incompletely addressed; position present but development unclear/limited; insufficiently developed ideas and possible irrelevant detail.
- Band 4: prompt tackled minimally or tangentially; position hard to find; ideas lack relevance/clarity/support; repetition is common.
- Band 3: prompt misunderstood or not adequately addressed; no relevant position; very few ideas.
- Band 2: barely related; no identifiable position; little relevant message/off-topic.
- Band 1: 20 words or fewer, or wholly unrelated content.
- Band 0: no attempt/non-English throughout/proven memorised answer.

COMMON CRITERIA (BOTH TASKS)

Coherence and Cohesion:
- Band 9: effortless progression, cohesive control, skilful paragraphing.
- Band 8: logical sequencing and well-managed cohesion with only occasional lapses.
- Band 7: logical organisation and clear progression; cohesive devices used with some inaccuracy/overuse.
- Band 6: generally coherent progression; cohesion sometimes mechanical/faulty; referencing/substitution may be unclear.
- Band 5: organisation evident but not wholly logical; weak linking fluency; limited/overused cohesive devices; repetitive referencing.
- Band 4: ideas present but not coherently arranged; unclear relationships; inaccurate/repetitive basic cohesion; weak paragraph control.
- Band 3: no clear logical organisation; minimal sequencers/cohesive devices; referencing difficult to identify.
- Band 2: little evidence of organisational control.
- Band 1: 20 words or fewer / no communicative message.
- Band 0: no attempt/non-English throughout/proven memorised answer.

Lexical Resource:
- Band 9: wide and sophisticated vocabulary with precise natural control; errors are extremely rare.
- Band 8: wide, flexible and mostly precise vocabulary; good uncommon usage with occasional collocation/choice errors.
- Band 7: sufficient range for flexibility and precision; some less common items; few spelling/word-formation errors.
- Band 6: generally adequate vocabulary; meaning clear despite limited precision; some spelling/word-formation errors.
- Band 5: limited but minimally adequate range; frequent simplification/repetition; noticeable lexical/spelling errors.
- Band 4: limited/inadequate or partly unrelated lexis; repetitive/basic language; lexical errors may impede meaning.
- Band 3: inadequate resource, often underlength or memorised dependence; spelling/word-choice errors may severely impede meaning.
- Band 2: extremely limited resource; almost no control of word formation/spelling.
- Band 1: 20 words or fewer / almost no usable resource.
- Band 0: no attempt/non-English throughout/proven memorised answer.

Grammatical Range and Accuracy:
- Band 9: wide range of structures with full control; grammar/punctuation consistently appropriate.
- Band 8: wide range used flexibly and accurately; most sentences error-free.
- Band 7: variety of complex structures with generally good control; errors are few and do not impede communication.
- Band 6: mix of simple/complex forms with limited flexibility; complex forms less accurate; errors rarely impede communication.
- Band 5: limited/repetitive structures; faulty complex attempts; frequent grammar errors may cause reader difficulty.
- Band 4: very limited structures; mostly simple sentences; frequent grammar/punctuation errors may impede meaning.
- Band 3: sentence forms attempted but errors predominate and block much meaning; often insufficient length evidence.
- Band 2: little or no evidence of sentence-form control.
- Band 1: 20 words or fewer / no rateable language control.
- Band 0: no attempt/non-English throughout/proven memorised answer.

SCORING AND OUTPUT RULES:
- If clearly off-topic, set off_topic = true and score Task Achievement/Task Response at Band 2.0 or below.
- Word count minimum: Task 1 = 150, Task 2 = 250. If below minimum, set word_count_penalty = true.
- Count candidate paragraphs and return paragraph_count.
- Detect verbatim copied spans from prompt/instruction and return copied_from_question.
- Flag mixed British/American spelling in weaknesses.

Return ONLY valid JSON.`;

const SPEAKING_SYSTEM_PROMPT = `You are a certified IELTS Speaking examiner.
Assess strictly by IELTS Speaking descriptors and return only valid JSON.

Evaluate four criteria independently:
1) Fluency and Coherence
2) Lexical Resource
3) Grammatical Range and Accuracy
4) Pronunciation

Rules:
- Use half bands (0.0 to 9.0).
- Be strict, do not inflate scores.
- Base judgment on the provided prompt and transcript only.
- Provide concise, actionable feedback.
`;

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

/**
 * Structured Outputs JSON Schema — guarantees the model always returns
 * exactly this shape. Every object level must have `additionalProperties: false`
 * and list all fields in `required`.  Nullable unions use `["type","null"]`.
 */
const IELTS_EVALUATION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'ielts_writing_evaluation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'task_type',
      'scores',
      'overall_band',
      'word_count_penalty',
      'off_topic',
      'paragraph_count',
      'copied_from_question',
      'strengths',
      'weaknesses',
      'major_errors',
      'band_improvement_advice',
    ],
    properties: {
      task_type: { type: 'string', enum: ['task1', 'task2'] },
      scores: {
        type: 'object',
        additionalProperties: false,
        required: [
          'task_achievement',
          'coherence_cohesion',
          'lexical_resource',
          'grammar',
        ],
        properties: {
          task_achievement: { type: 'number' },
          coherence_cohesion: { type: 'number' },
          lexical_resource: { type: 'number' },
          grammar: { type: 'number' },
        },
      },
      overall_band: { type: 'number' },
      word_count_penalty: { type: 'boolean' },
      off_topic: { type: 'boolean' },
      paragraph_count: { type: 'number' },
      copied_from_question: { type: 'array', items: { type: 'string' } },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      major_errors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['original', 'correction', 'reason'],
          properties: {
            original: { type: 'string' },
            correction: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      band_improvement_advice: { type: 'array', items: { type: 'string' } },
    },
  },
};

const IELTS_SPEAKING_SCHEMA = {
  type: 'json_schema' as const,
  name: 'ielts_speaking_evaluation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'scores',
      'overall_band',
      'strengths',
      'weaknesses',
      'improvement_tips',
      'estimated_cefr',
    ],
    properties: {
      scores: {
        type: 'object',
        additionalProperties: false,
        required: [
          'fluency_coherence',
          'lexical_resource',
          'grammatical_range_accuracy',
          'pronunciation',
        ],
        properties: {
          fluency_coherence: { type: 'number' },
          lexical_resource: { type: 'number' },
          grammatical_range_accuracy: { type: 'number' },
          pronunciation: { type: 'number' },
        },
      },
      overall_band: { type: 'number' },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      improvement_tips: { type: 'array', items: { type: 'string' } },
      estimated_cefr: { type: 'string' },
    },
  },
};

/**
 * Resolve a non-public image URL to a base64 data URL by reading the
 * file from the local uploads directory.  Returns the data URL string
 * on success, or null if the file cannot be read.
 */
const tryBase64Fallback = (imageUrl: string): string | null => {
  try {
    const parsed = new URL(imageUrl);
    // Extract filename from the URL path (e.g. /uploads/w1.png -> w1.png)
    const urlPath = decodeURIComponent(parsed.pathname);
    const uploadsIndex = urlPath.indexOf('/uploads/');
    if (uploadsIndex === -1) {
      return null;
    }

    const filename = urlPath.substring(uploadsIndex + '/uploads/'.length);
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return null;
    }

    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mime = mimeMap[ext] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
};

const buildTaskContent = (
  input: EvaluateWritingSectionInput,
  logger?: Logger,
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
      // Public URL — OpenAI can fetch it directly
      content.push({
        type: 'input_image',
        image_url: resolvedImageUrl,
      });
    } else if (resolvedImageUrl) {
      // Non-public URL — try reading from local uploads and encoding as base64
      const base64DataUrl = tryBase64Fallback(resolvedImageUrl);
      if (base64DataUrl) {
        logger?.warn(
          `Image URL not publicly accessible, using base64 fallback: ${resolvedImageUrl}`,
        );
        content.push({
          type: 'input_image',
          image_url: base64DataUrl,
        });
      } else {
        logger?.warn(
          `Image URL not publicly accessible and local file not found, sending as text: ${resolvedImageUrl}`,
        );
        content.push({
          type: 'input_text',
          text: `Image URL (not accessible to you): ${resolvedImageUrl}`,
        });
      }
    } else {
      content.push({
        type: 'input_text',
        text: 'Image URL: N/A',
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

const validateResponseStatus = (response: OpenAIResponsesResponse): void => {
  // Check for API-level errors
  if (response.error) {
    const errMsg = response.error.message || response.error.code || 'unknown';
    throw new Error(`OpenAI API error: ${errMsg}`);
  }

  // Check for incomplete responses (e.g., max_output_tokens hit)
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason || 'unknown';
    throw new Error(
      `OpenAI response incomplete (reason: ${reason}). ` +
        `The model output was cut short — consider increasing max_output_tokens.`,
    );
  }

  // Check for failed status
  if (response.status === 'failed') {
    throw new Error('OpenAI response status: failed');
  }

  // Check for refusals
  const refusal = response.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .find((c) => c.type === 'refusal');

  if (refusal?.refusal) {
    throw new Error(`OpenAI model refused the request: ${refusal.refusal}`);
  }
};

const extractOutputText = (response: OpenAIResponsesResponse): string => {
  // SDK-only convenience field — present when using the OpenAI SDK,
  // but not guaranteed in raw HTTP responses.
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  // Walk the Responses API structure:
  //   output[] -> items with type "message" -> content[] -> items with type "output_text" -> .text
  const textParts =
    response.output
      ?.filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .filter(Boolean) ?? [];

  return textParts.join('\n').trim();
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

const hasWordCountPenalty = (
  taskType: IeltsWritingTaskType,
  wordCount: number,
): boolean => {
  if (taskType === 'task1') {
    return wordCount < 150;
  }

  return wordCount < 250;
};

const violatesEnglishOnlyRule = (essay: string): boolean => {
  for (const character of essay) {
    if (/\p{L}/u.test(character) && !/[A-Za-z]/.test(character)) {
      return true;
    }
  }

  return false;
};

const countParagraphs = (essay: string): number => {
  return essay
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0).length;
};

const buildEnglishOnlyViolationResult = (
  taskType: IeltsWritingTaskType,
  wordCount: number,
  essay: string,
): IeltsWritingResult => {
  const policyMessage =
    'IELTS Writing requires English only. Mixed/non-English language was detected, so the score is 0.';

  return {
    task_type: taskType,
    scores: {
      task_achievement: 0,
      coherence_cohesion: 0,
      lexical_resource: 0,
      grammar: 0,
    },
    overall_band: 0,
    word_count_penalty: hasWordCountPenalty(taskType, wordCount),
    off_topic: false,
    paragraph_count: countParagraphs(essay),
    copied_from_question: [],
    strengths: [],
    weaknesses: [policyMessage],
    major_errors: [
      {
        original: '',
        correction: '',
        reason: 'Language policy violation: response must be fully in English.',
      },
    ],
    band_improvement_advice: [
      'Write your full response in English only.',
      'Do not mix English with any other language in IELTS Writing.',
    ],
  };
};

const buildTooShortResponseResult = (
  taskType: IeltsWritingTaskType,
  wordCount: number,
  essay: string,
): IeltsWritingResult => {
  const descriptorMessage =
    'Official IELTS Writing descriptors rate responses of 20 words or fewer at Band 1.';

  return {
    task_type: taskType,
    scores: {
      task_achievement: 1,
      coherence_cohesion: 1,
      lexical_resource: 1,
      grammar: 1,
    },
    overall_band: 1,
    word_count_penalty: hasWordCountPenalty(taskType, wordCount),
    off_topic: false,
    paragraph_count: countParagraphs(essay),
    copied_from_question: [],
    strengths: [],
    weaknesses: [descriptorMessage],
    major_errors: [
      {
        original: '',
        correction: '',
        reason:
          'Response length is 20 words or fewer (descriptor-limited to Band 1).',
      },
    ],
    band_improvement_advice: [
      taskType === 'task1'
        ? 'Write at least 150 words with a clear overview and key-feature support.'
        : 'Write at least 250 words with a clear position and developed supporting ideas.',
      'Develop full paragraphs so each criterion can be assessed above Band 1.',
    ],
  };
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

const resolveUploadFilePathFromUrl = (audioUrl: string): string | null => {
  try {
    const parsed = new URL(audioUrl);
    const pathname = decodeURIComponent(parsed.pathname);
    const uploadsPrefix = '/uploads/';
    const index = pathname.indexOf(uploadsPrefix);
    if (index < 0) {
      return null;
    }

    const filename = pathname.substring(index + uploadsPrefix.length);
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return null;
    }

    return path.join(process.cwd(), 'uploads', filename);
  } catch {
    return null;
  }
};

const getMimeFromAudioFilePath = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
  };
  return mimeByExt[ext] || 'application/octet-stream';
};

const toSpeakingScores = (value: unknown): IeltsSpeakingScores => {
  const parsed =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  return {
    fluency_coherence: clampBand(parsed.fluency_coherence),
    lexical_resource: clampBand(parsed.lexical_resource),
    grammatical_range_accuracy: clampBand(parsed.grammatical_range_accuracy),
    pronunciation: clampBand(parsed.pronunciation),
  };
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

    if (violatesEnglishOnlyRule(normalizedEssay)) {
      this.logger.warn(
        `English-only policy violation detected for ${normalizedInput.taskType}. Returning zero score without AI call.`,
      );

      return buildEnglishOnlyViolationResult(
        normalizedInput.taskType,
        normalizedInput.wordCount,
        normalizedEssay,
      );
    }

    if (normalizedInput.wordCount <= 20) {
      this.logger.warn(
        `Detected ${normalizedInput.wordCount} words for ${normalizedInput.taskType}. Returning descriptor-limited Band 1 without AI call.`,
      );

      return buildTooShortResponseResult(
        normalizedInput.taskType,
        normalizedInput.wordCount,
        normalizedEssay,
      );
    }

    return this.circuitBreaker.execute(async () => {
      try {
        const response = await this.requestResponsesApi(normalizedInput);

        this.logger.debug(
          `OpenAI response (id=${response.id}, status=${response.status})`,
        );

        // Validate the response before attempting to extract text
        validateResponseStatus(response);

        const outputText = extractOutputText(response);
        if (!outputText) {
          this.logger.error(
            `Empty output_text extracted from response (id=${response.id}, status=${response.status}). ` +
              `Output items: ${JSON.stringify(response.output?.map((o) => ({ type: o.type, status: o.status, contentTypes: o.content?.map((c) => c.type) })))}`,
          );
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

  async transcribeAudioFromUrl(audioUrl: string): Promise<string> {
    if (!this.openAiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const filePath = resolveUploadFilePathFromUrl(audioUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Audio file not found for transcription');
    }

    const buffer = fs.readFileSync(filePath);
    const mime = getMimeFromAudioFilePath(filePath);
    const filename = path.basename(filePath);
    const blob = new Blob([buffer], { type: mime });
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('response_format', 'json');
    formData.append('language', 'en');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(
        `OpenAI transcription failed: status ${response.status} ${bodyText}`,
      );
    }

    const responseBodyText = await response.text().catch(() => '');

    let transcript = '';
    if (responseBodyText.trim().length > 0) {
      try {
        const payload = JSON.parse(
          responseBodyText,
        ) as OpenAITranscriptionResponse;
        const segmentText = Array.isArray(payload.segments)
          ? payload.segments
              .map((segment) => toSafeText(segment?.text))
              .filter((segment) => segment.length > 0)
              .join(' ')
          : '';

        transcript =
          toSafeText(payload.text) ||
          toSafeText(payload.transcript) ||
          toSafeText(payload.output_text) ||
          toSafeText(segmentText);
      } catch {
        transcript = toSafeText(responseBodyText);
      }
    }

    if (!transcript) {
      throw new Error('NO_SPEECH_DETECTED');
    }

    return transcript;
  }

  async evaluateSpeakingSection(
    input: EvaluateSpeakingSectionInput,
  ): Promise<IeltsSpeakingResult> {
    if (!this.openAiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const prompt = toSafeText(input.prompt);
    const transcription = toSafeText(input.transcription);
    if (!transcription) {
      throw new Error('Speaking transcription is empty');
    }

    const response = await this.httpClient.post<OpenAIResponsesResponse>(
      'https://api.openai.com/v1/responses',
      {
        model: this.openAiModel,
        instructions: SPEAKING_SYSTEM_PROMPT,
        max_output_tokens: 4096,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `IELTS speaking prompt: ${prompt || 'N/A'}`,
              },
              {
                type: 'input_text',
                text: `Candidate transcript: ${transcription}`,
              },
              {
                type: 'input_text',
                text: `Approx duration in seconds: ${Math.max(0, Math.floor(Number(input.audioDurationSeconds || 0)))}`,
              },
            ],
          },
        ],
        text: {
          format: IELTS_SPEAKING_SCHEMA,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: this.evaluationTimeoutMs,
      },
    );

    validateResponseStatus(response);
    const outputText = extractOutputText(response);
    if (!outputText) {
      throw new Error('OpenAI speaking evaluation returned empty output');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(outputText) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Invalid speaking evaluation JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const scores = toSpeakingScores(parsed.scores);
    const averageBand =
      (scores.fluency_coherence +
        scores.lexical_resource +
        scores.grammatical_range_accuracy +
        scores.pronunciation) /
      4;

    return {
      scores,
      overall_band: clampBand(parsed.overall_band ?? averageBand),
      strengths: toStringArray(parsed.strengths),
      weaknesses: toStringArray(parsed.weaknesses),
      improvement_tips: toStringArray(parsed.improvement_tips),
      estimated_cefr: toSafeText(parsed.estimated_cefr),
    };
  }

  private async requestResponsesApi(
    input: EvaluateWritingSectionInput,
  ): Promise<OpenAIResponsesResponse> {
    const requestBody = {
      model: this.openAiModel,
      instructions: SYSTEM_PROMPT,
      max_output_tokens: 8192,
      input: [
        {
          role: 'user',
          content: buildTaskContent(input, this.logger),
        },
      ],
      text: {
        format: IELTS_EVALUATION_SCHEMA,
      },
    };

    return this.httpClient.post<OpenAIResponsesResponse>(
      'https://api.openai.com/v1/responses',
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: this.evaluationTimeoutMs,
      },
    );
  }

  private parseResult(
    rawText: string,
    input: EvaluateWritingSectionInput,
  ): IeltsWritingResult {
    try {
      // With Structured Outputs (json_schema + strict: true) the model is
      // guaranteed to return valid JSON matching our schema — no need for
      // markdown stripping or regex extraction.
      const parsed = JSON.parse(rawText) as Record<string, unknown>;

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

      const offTopic = Boolean(parsed.off_topic);
      if (offTopic && scores.task_achievement > 2) {
        scores.task_achievement = 2;
      }

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
      const boundedOverallBand = offTopic
        ? Math.min(overallBandRaw, averageBand)
        : overallBandRaw;

      const forcedPenalty = hasWordCountPenalty(
        input.taskType,
        input.wordCount,
      );

      return {
        task_type: modelTaskType,
        scores,
        overall_band: clampBand(boundedOverallBand),
        word_count_penalty: forcedPenalty || Boolean(parsed.word_count_penalty),
        off_topic: offTopic,
        paragraph_count:
          typeof parsed.paragraph_count === 'number' &&
          Number.isFinite(parsed.paragraph_count)
            ? Math.max(0, Math.floor(parsed.paragraph_count))
            : 0,
        copied_from_question: toStringArray(parsed.copied_from_question),
        strengths: toStringArray(parsed.strengths),
        weaknesses: toStringArray(parsed.weaknesses),
        major_errors: toMajorErrors(parsed.major_errors),
        band_improvement_advice: toStringArray(parsed.band_improvement_advice),
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse OpenAI writing evaluation JSON: ${rawText.substring(0, 200)}`,
      );
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
