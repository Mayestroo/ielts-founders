import {
  FlowChartData,
  MatchItem,
  Question,
  QuestionType,
  TableData,
} from '@/types';

export const questionTypes: {
  value: QuestionType;
  label: string;
  category: string;
}[] = [
  { value: 'MCQ_SINGLE', label: 'Multiple Choice (Single)', category: 'MCQ' },
  {
    value: 'MCQ_MULTIPLE',
    label: 'Multiple Choice (Multiple)',
    category: 'MCQ',
  },
  {
    value: 'TRUE_FALSE_NOT_GIVEN',
    label: 'True/False/Not Given',
    category: 'Identification',
  },
  {
    value: 'YES_NO_NOT_GIVEN',
    label: 'Yes/No/Not Given',
    category: 'Identification',
  },
  { value: 'FILL_BLANK', label: 'Fill in the Blank', category: 'Completion' },
  { value: 'SHORT_ANSWER', label: 'Short Answer', category: 'Completion' },
  {
    value: 'SENTENCE_COMPLETION',
    label: 'Sentence Completion',
    category: 'Completion',
  },
  {
    value: 'SUMMARY_COMPLETION',
    label: 'Summary Completion',
    category: 'Completion',
  },
  {
    value: 'NOTE_COMPLETION',
    label: 'Note Completion',
    category: 'Completion',
  },
  {
    value: 'TABLE_COMPLETION',
    label: 'Table Completion',
    category: 'Completion',
  },
  {
    value: 'FLOW_CHART_COMPLETION',
    label: 'Flow Chart Completion',
    category: 'Completion',
  },
  {
    value: 'FORM_COMPLETION',
    label: 'Form Completion',
    category: 'Completion',
  },
  { value: 'MATCHING', label: 'Matching', category: 'Matching' },
  { value: 'DIAGRAM_LABELING', label: 'Diagram Labeling', category: 'Visual' },
  {
    value: 'PLAN_MAP_LABELING',
    label: 'Plan/Map Labeling',
    category: 'Visual',
  },
];

export type QuestionWithAdvancedFields = Question & {
  title?: string;
  questionRange?: string;
  isInSameLine?: boolean;
  questionsLabel?: string;
  optionsLabel?: string;
  tableData?: TableData;
  flowchartData?: FlowChartData;
  items?: MatchItem[];
  matchOptions?: MatchItem[];
  correctAnswer?: Record<string, string> | string;
};

export const emptyTableData: TableData = {
  headers: [],
  rows: [],
};

export const emptyFlowchartData: FlowChartData = {
  steps: [],
};

export const resolveAudioSourceUrl = (audioUrl: string): string => {
  const trimmed = audioUrl.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('http')) {
    return trimmed;
  }

  const baseUrl = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'
  ).replace('/api', '');

  return `${baseUrl}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
};

export const readAudioDurationMinutes = async (
  audioUrl: string,
): Promise<number | null> => {
  const source = resolveAudioSourceUrl(audioUrl);
  if (!source) {
    return null;
  }

  return new Promise((resolve) => {
    const audio = new Audio();

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration)
        ? Math.ceil(audio.duration / 60)
        : 0;
      cleanup();
      resolve(duration > 0 ? duration : null);
    };

    const handleError = () => {
      cleanup();
      resolve(null);
    };

    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
    audio.src = source;
  });
};

export const buildDefaultQuestion = ({
  type,
  number,
  passageId,
}: {
  type: QuestionType;
  number: number;
  passageId: string;
}): Question => {
  const baseQuestion = {
    id: `q-${Date.now()}`,
    number,
    type,
    questionText: '',
    passageId,
    points: 1,
    instruction: '',
  };

  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTIPLE':
      return {
        ...baseQuestion,
        type,
        options: [
          { id: 'a', text: '' },
          { id: 'b', text: '' },
          { id: 'c', text: '' },
          { id: 'd', text: '' },
        ],
        correctAnswer: type === 'MCQ_SINGLE' ? '' : [],
      };
    case 'TRUE_FALSE_NOT_GIVEN':
    case 'YES_NO_NOT_GIVEN':
      return {
        ...baseQuestion,
        type,
        correctAnswer: 'TRUE' as const,
      };
    case 'MATCHING':
    case 'DIAGRAM_LABELING':
    case 'PLAN_MAP_LABELING':
      return {
        ...baseQuestion,
        type,
        items: [{ id: 'item1', text: '' }],
        matchOptions: [{ id: 'opt1', text: '' }],
        correctAnswer: {},
      };
    default:
      return {
        ...baseQuestion,
        type,
        correctAnswer: '',
        wordLimit: 3,
      } as Question;
  }
};

export const createMatchId = (prefix: 'item' | 'opt') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const toMatchingAnswerMap = (
  value: Record<string, string> | string | undefined,
): Record<string, string> => {
  if (!value || typeof value === 'string' || Array.isArray(value)) {
    return {};
  }

  return value;
};
