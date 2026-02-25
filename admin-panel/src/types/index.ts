// Type definitions for IELTS Mock Platform

export type Role = "SUPER_ADMIN" | "CENTER_ADMIN" | "TEACHER" | "STUDENT";
export type ExamSectionType = "LISTENING" | "READING" | "WRITING";
export type AssignmentStatus = "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED";
export type SessionAttendanceMode = "ONLINE" | "OFFLINE";
export type SessionReferralSource =
  | "TELEGRAM"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "GOOGLE"
  | "FRIENDS"
  | "OTHER";

export interface Center {
  id: string;
  name: string;
  logo?: string;
  hasLoginPassword?: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    users: number;
    examSections: number;
  };
}

export interface User {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  premiumActive?: boolean;
  isPremium?: boolean;
  sessionAttendanceMode?: SessionAttendanceMode;
  sessionScheduledAt?: string;
  sessionReferralSource?: SessionReferralSource;
  phoneNumber?: string;
  centerId?: string;
  center?: Center;
  createdAt: string;
  updatedAt: string;
}

export interface StudentSummary {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}

// Question Types
export type QuestionType =
  | "MCQ_SINGLE"
  | "MCQ_MULTIPLE"
  | "TRUE_FALSE_NOT_GIVEN"
  | "YES_NO_NOT_GIVEN"
  | "FILL_BLANK"
  | "SHORT_ANSWER"
  | "MATCHING"
  | "SENTENCE_COMPLETION"
  | "SUMMARY_COMPLETION"
  | "NOTE_COMPLETION"
  | "TABLE_COMPLETION"
  | "FLOW_CHART_COMPLETION"
  | "DIAGRAM_LABELING"
  | "FORM_COMPLETION"
  | "PLAN_MAP_LABELING";

export interface QuestionOption {
  id: string;
  text: string;
}

export interface MatchItem {
  id: string;
  text: string;
}

export interface TableData {
  title?: string;
  headers: string[];
  rows: string[][];
}

export interface FlowChartStep {
  text: string;
  isQuestion?: boolean;
}

export interface FlowChartData {
  title?: string;
  steps: FlowChartStep[];
}

export interface BaseQuestion {
  id: string;
  number?: number;
  type: QuestionType;
  title?: string;
  questionText: string;
  instruction?: string;
  imageUrl?: string;
  passageId?: string;
  points: number;
  partAudioUrl?: string;
  partDurationMinutes?: number;
  questionRange?: string;
  isInSameLine?: boolean;
  questionsLabel?: string;
  optionsLabel?: string;
}

export interface MCQQuestion extends BaseQuestion {
  type: "MCQ_SINGLE" | "MCQ_MULTIPLE";
  options: QuestionOption[];
  correctAnswer: string | string[];
}

export interface TrueFalseQuestion extends BaseQuestion {
  type: "TRUE_FALSE_NOT_GIVEN" | "YES_NO_NOT_GIVEN";
  correctAnswer: "TRUE" | "FALSE" | "NOT_GIVEN" | "YES" | "NO";
}

export interface FillBlankQuestion extends BaseQuestion {
  type:
    | "FILL_BLANK"
    | "SENTENCE_COMPLETION"
    | "SUMMARY_COMPLETION"
    | "NOTE_COMPLETION"
    | "TABLE_COMPLETION"
    | "FLOW_CHART_COMPLETION"
    | "FORM_COMPLETION";
  correctAnswer: string;
  wordLimit?: number;
  tableData?: TableData;
  flowchartData?: FlowChartData;
  options?: QuestionOption[];
}

export interface ShortAnswerQuestion extends BaseQuestion {
  type: "SHORT_ANSWER";
  correctAnswer: string;
  wordLimit?: number;
}

export interface MatchingQuestion extends BaseQuestion {
  type: "MATCHING" | "DIAGRAM_LABELING" | "PLAN_MAP_LABELING";
  items: MatchItem[];
  matchOptions: MatchItem[];
  correctAnswer: Record<string, string> | string;
}

export type Question =
  | MCQQuestion
  | TrueFalseQuestion
  | FillBlankQuestion
  | ShortAnswerQuestion
  | MatchingQuestion;

export interface Passage {
  id: string;
  title: string;
  content: string;
}

export interface ExamSection {
  id: string;
  title: string;
  type: ExamSectionType;
  description?: string;
  duration: number;
  questions: Question[];
  audioUrl?: string;
  passages?: Passage[];
  teacherId: string;
  centerId: string;
  teacher?: User;
  center?: Center;
  createdAt: string;
  updatedAt: string;
}

export interface ExamSectionOption {
  id: string;
  title: string;
  type: ExamSectionType;
  duration: number;
}

export interface ExamAssignment {
  id: string;
  studentId: string;
  sectionId: string;
  status: AssignmentStatus;
  startTime?: string;
  endTime?: string;
  answers?: Record<string, unknown>;
  highlights?: Record<string, unknown>;
  score?: number;
  fullMockSessionId?: string | null;
  fullMockSequence?: number | null;
  resultsVisibleToStudent?: boolean;
  student?: User;
  section?: ExamSection;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentGroup {
  student: StudentSummary;
  latestDate: string;
  hasFullMock: boolean;
  resultsVisibleToStudent?: boolean | null;
  stats: {
    assigned: number;
    progress: number;
    submitted: number;
    total: number;
  };
  previewAssignments: {
    id: string;
    status: AssignmentStatus;
    fullMockSessionId?: string | null;
    createdAt: string;
    section?: {
      id: string;
      title: string;
      type: ExamSectionType;
      duration: number;
    };
  }[];
}

export interface GroupedAssignmentsResponse {
  groups: AssignmentGroup[];
  total: number;
}

export interface CreateFullMockForm {
  studentId: string;
  listeningSectionId: string;
  readingSectionId: string;
  writingSectionId: string;
  showResultsToStudent?: boolean;
}

export interface CreateBulkFullMockForm {
  studentIds: string[];
  listeningSectionId: string;
  readingSectionId: string;
  writingSectionId: string;
  showResultsToStudent?: boolean;
}

export interface BulkFullMockResult {
  results: Array<{
    studentId: string;
    studentName: string;
    success: boolean;
    error?: string;
  }>;
  successCount: number;
  errorCount: number;
}

export interface WritingSubmission {
  id: string;
  resultId: string;
  studentId: string;
  sectionId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "MANUAL_REVIEW";
  bandScore?: number;
  evaluation?: Record<string, unknown>;
  lastError?: string;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  processingAt?: string;
  completedAt?: string;
}

export interface ExamResult {
  id: string;
  studentId: string;
  sectionId: string;
  score: number;
  totalScore: number;
  bandScore?: number;
  answers: Record<string, unknown>;
  feedback?: Record<string, unknown>;
  submittedAt: string;
  student?: User;
  section?: ExamSection;
  writingSubmission?: WritingSubmission;
}

// Form types
export interface CreateUserForm {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  premiumActive?: boolean;
  sessionAttendanceMode?: SessionAttendanceMode;
  sessionScheduledAt?: string;
  sessionReferralSource?: SessionReferralSource;
  phoneNumber?: string;
  role: Role;
  centerId?: string;
}

export interface CreateCenterForm {
  name: string;
  logo?: string;
  loginPassword?: string;
}

export interface CreateExamSectionForm {
  title: string;
  type: ExamSectionType;
  description?: string;
  duration: number;
  questions: Question[];
  audioUrl?: string;
  passages?: Passage[];
  centerId?: string;
}

export interface CreateAssignmentForm {
  studentId: string;
  sectionId: string;
}
