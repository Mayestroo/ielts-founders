// Type definitions for IELTS Mock Platform

export type Role = "SUPER_ADMIN" | "CENTER_ADMIN" | "TEACHER" | "STUDENT";
export type ExamSectionType = "LISTENING" | "READING" | "WRITING";
export type AssignmentStatus = "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED";

export interface Center {
  id: string;
  name: string;
  logo?: string;
  loginPassword?: string;
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
  centerId?: string;
  center?: Center;
  createdAt: string;
  updatedAt: string;
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

export interface BaseQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  instruction?: string;
  imageUrl?: string;
  passageId?: string;
  points: number;
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
  correctAnswer: Record<string, string>;
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

export interface ExamAssignment {
  id: string;
  studentId: string;
  sectionId: string;
  status: AssignmentStatus;
  startTime?: string;
  endTime?: string;
  answers?: Record<string, any>;
  highlights?: Record<string, any>;
  score?: number;
  student?: User;
  section?: ExamSection;
  createdAt: string;
  updatedAt: string;
}

export interface ExamResult {
  id: string;
  studentId: string;
  sectionId: string;
  score: number;
  totalScore: number;
  bandScore?: number;
  answers: Record<string, any>;
  feedback?: Record<string, any>;
  submittedAt: string;
  student?: User;
  section?: ExamSection;
}

// Form types
export interface CreateUserForm {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
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
}

export interface CreateAssignmentForm {
  studentId: string;
  sectionId: string;
}
