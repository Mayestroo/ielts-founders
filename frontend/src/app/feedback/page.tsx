"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { generateResultPDF, StudentReportData } from "@/lib/generatePDF";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import { ExamAssignment, ExamResult, ExamSectionType, Question } from "@/types";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

type FeedbackSectionType = Extract<
  ExamSectionType,
  "LISTENING" | "READING" | "WRITING" | "SPEAKING"
>;

interface IncorrectFeedbackItem {
  key: string;
  questionNumber: number;
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  reason: string;
  isCorrect: boolean;
}

interface WritingCriterionScores {
  task_achievement: number;
  coherence_cohesion: number;
  lexical_resource: number;
  grammar: number;
}

interface WritingTaskFeedback {
  task: string;
  overall_band: number;
  scores: WritingCriterionScores;
  off_topic?: boolean;
  paragraph_count?: number;
  copied_from_question?: string[];
  strengths: string[];
  weaknesses: string[];
  band_improvement_advice: string[];
}

interface WritingFeedbackSummary {
  overall: string | null;
  overallBand: number | null;
  weightedScores: WritingCriterionScores | null;
  strengths: string[];
  improvements: string[];
  tasks: WritingTaskFeedback[];
}

interface SpeakingCriterionScores {
  fluency_coherence: number | null;
  lexical_resource: number | null;
  grammatical_range_accuracy: number | null;
  pronunciation: number | null;
}

interface SpeakingFeedbackSummary {
  overallBand: number | null;
  criteria: SpeakingCriterionScores;
  comment: string | null;
  gradedAt: string | null;
  isManual: boolean;
}

const SECTION_ORDER: FeedbackSectionType[] = [
  "LISTENING",
  "READING",
  "WRITING",
  "SPEAKING",
];

const SECTION_LABELS: Record<FeedbackSectionType, string> = {
  LISTENING: "Listening",
  READING: "Reading",
  WRITING: "Writing",
  SPEAKING: "Speaking",
};

const EMPTY_RESULTS_BY_TYPE: Record<FeedbackSectionType, ExamResult | null> = {
  LISTENING: null,
  READING: null,
  WRITING: null,
  SPEAKING: null,
};

const buildFullMockSectionIdSet = (assignments: ExamAssignment[]) => {
  const fullMockSectionIds = new Set<string>();

  for (const assignment of assignments) {
    if (
      !assignment.fullMockSessionId ||
      !assignment.section?.id ||
      assignment.resultsVisibleToStudent === false
    ) {
      continue;
    }

    fullMockSectionIds.add(assignment.section.id);
  }

  return fullMockSectionIds;
};

interface SectionFeedbackMeta {
  incorrectItems: IncorrectFeedbackItem[];
  totalQuestions: number;
  correctCount: number;
  isReady: boolean;
}

const getLatestResultsByType = (results: ExamResult[]) => {
  const latestByType: Record<FeedbackSectionType, ExamResult | null> = {
    LISTENING: null,
    READING: null,
    WRITING: null,
    SPEAKING: null,
  };

  for (const result of results) {
    const sectionType = result.section?.type;
    if (!sectionType || !SECTION_ORDER.includes(sectionType as FeedbackSectionType)) {
      continue;
    }

    const typedSection = sectionType as FeedbackSectionType;
    const existing = latestByType[typedSection];

    if (!existing) {
      latestByType[typedSection] = result;
      continue;
    }

    if (
      new Date(result.submittedAt).getTime() > new Date(existing.submittedAt).getTime()
    ) {
      latestByType[typedSection] = result;
    }
  }

  return latestByType;
};

const hasDetailedSectionData = (result: ExamResult | null) => {
  return Boolean(result?.section?.questions?.length);
};

const buildSectionFeedbackMeta = (result: ExamResult | null): SectionFeedbackMeta => {
  if (!hasDetailedSectionData(result)) {
    return {
      incorrectItems: [],
      totalQuestions: 0,
      correctCount: 0,
      isReady: false,
    };
  }

  const { incorrectItems, totalQuestions, correctCount } =
    getIncorrectFeedbackItems(result!);

  return {
    incorrectItems,
    totalQuestions,
    correctCount,
    isReady: true,
  };
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const getResultAnswers = (result: ExamResult): Record<string, unknown> => {
  return (result.answers || {}) as Record<string, unknown>;
};

/** Result was explicitly stamped as a standalone (online) attempt. */
const isStandaloneResult = (answers: Record<string, unknown>): boolean => {
  if (answers._attemptMode === "standalone") return true;
  return answers._isStandalone === true;
};

/** Return the full-mock session id stamped on the result, or "". */
const getResultFullMockSessionId = (answers: Record<string, unknown>): string => {
  if (typeof answers._fullMockSessionId !== "string") return "";
  return answers._fullMockSessionId.trim();
};

const hasAnswer = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isObjectRecord(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
};

const normalizeText = (value: unknown) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/\bcentres\b/g, "centers")
    .replace(/\bcentre\b/g, "center")
    .replace(/\b1st\b/g, "first")
    .replace(/\b2nd\b/g, "second")
    .replace(/\b3rd\b/g, "third")
    .replace(/\b4th\b/g, "fourth")
    .replace(/\b5th\b/g, "fifth")
    .replace(/\b6th\b/g, "sixth")
    .replace(/\b7th\b/g, "seventh")
    .replace(/\b8th\b/g, "eighth")
    .replace(/\b9th\b/g, "ninth")
    .replace(/\b10th\b/g, "tenth");

const formatAnswerValue = (value: unknown, questionType: Question["type"]): string => {
  if (!hasAnswer(value)) {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).toUpperCase()).join(", ");
  }

  if (isObjectRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${String(entry).toUpperCase()}`)
      .join(", ");
  }

  if (
    questionType === "MCQ_SINGLE" ||
    questionType === "TRUE_FALSE_NOT_GIVEN" ||
    questionType === "YES_NO_NOT_GIVEN"
  ) {
    return String(value).toUpperCase();
  }

  return String(value);
};

const resolveCorrectAnswer = (question: Question): unknown => {
  const correctAnswer = question.correctAnswer;

  if (
    (question.type === "MATCHING" ||
      question.type === "PLAN_MAP_LABELING" ||
      question.type === "DIAGRAM_LABELING") &&
    isObjectRecord(correctAnswer) &&
    question.id in correctAnswer
  ) {
    return correctAnswer[question.id];
  }

  return correctAnswer;
};

const isAnswerCorrect = (
  studentAnswer: unknown,
  correctAnswer: unknown,
  questionType: Question["type"],
): boolean => {
  if (!hasAnswer(studentAnswer) || !hasAnswer(correctAnswer)) {
    return false;
  }

  if (questionType === "MCQ_MULTIPLE") {
    const studentOptions = Array.isArray(studentAnswer)
      ? studentAnswer
      : [studentAnswer];
    const correctOptions = Array.isArray(correctAnswer)
      ? correctAnswer
      : [correctAnswer];

    const normalizedStudent = new Set(studentOptions.map((entry) => normalizeText(entry)));
    const normalizedCorrect = new Set(correctOptions.map((entry) => normalizeText(entry)));

    if (normalizedStudent.size !== normalizedCorrect.size) {
      return false;
    }

    for (const option of normalizedStudent) {
      if (!normalizedCorrect.has(option)) {
        return false;
      }
    }

    return true;
  }

  if (Array.isArray(correctAnswer)) {
    if (Array.isArray(studentAnswer)) {
      if (studentAnswer.length !== 1) {
        return false;
      }

      return correctAnswer.some(
        (entry) => normalizeText(studentAnswer[0]) === normalizeText(entry),
      );
    }

    return correctAnswer.some(
      (entry) => normalizeText(studentAnswer) === normalizeText(entry),
    );
  }

  if (
    questionType === "MATCHING" ||
    questionType === "PLAN_MAP_LABELING" ||
    questionType === "DIAGRAM_LABELING"
  ) {
    if (isObjectRecord(studentAnswer) && isObjectRecord(correctAnswer)) {
      const correctEntries = Object.entries(correctAnswer);

      if (correctEntries.length === 0) {
        return false;
      }

      return correctEntries.every(([key, expected]) => {
        const actual = studentAnswer[key];
        return normalizeText(actual) === normalizeText(expected);
      });
    }

    return normalizeText(studentAnswer) === normalizeText(correctAnswer);
  }

  return normalizeText(studentAnswer) === normalizeText(correctAnswer);
};

const getIncorrectReason = (
  questionType: Question["type"],
  studentAnswer: unknown,
): string => {
  if (!hasAnswer(studentAnswer)) {
    return "No answer was submitted for this question.";
  }

  if (questionType === "MCQ_MULTIPLE") {
    return "One or more selected options are missing or incorrect.";
  }

  if (
    questionType === "MATCHING" ||
    questionType === "PLAN_MAP_LABELING" ||
    questionType === "DIAGRAM_LABELING"
  ) {
    return "At least one of your matches does not align with the correct pair.";
  }

  if (
    questionType === "FILL_BLANK" ||
    questionType === "SHORT_ANSWER" ||
    questionType === "SENTENCE_COMPLETION" ||
    questionType === "SUMMARY_COMPLETION" ||
    questionType === "NOTE_COMPLETION" ||
    questionType === "TABLE_COMPLETION" ||
    questionType === "FLOW_CHART_COMPLETION" ||
    questionType === "FORM_COMPLETION"
  ) {
    return "Your response does not match the expected word or phrase.";
  }

  return "Your selected answer is different from the expected answer.";
};

const resolveStudentAnswerParts = (value: unknown): string[] => {
  if (!hasAnswer(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [String(value).trim()].filter((entry) => entry.length > 0);
};

interface FeedbackItemsResult {
  incorrectItems: IncorrectFeedbackItem[];
  totalQuestions: number;
  correctCount: number;
}

const resolveQuestionNumber = (question: Question, fallback: number): number => {
  if (typeof question.number === "number" && Number.isFinite(question.number) && question.number >= 1) {
    return question.number;
  }

  const idMatch = question.id.match(/\d+/);
  if (idMatch) {
    const parsed = Number.parseInt(idMatch[0], 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return fallback;
};

const getIncorrectFeedbackItems = (result: ExamResult): FeedbackItemsResult => {
  const questions = result.section?.questions || [];
  const answers = result.answers || {};

  const incorrectItems: IncorrectFeedbackItem[] = [];
  let runningCounter = 0;
  let totalQuestions = 0;
  let correctCount = 0;

  for (const question of questions) {
    const studentAnswer = answers[question.id];
    const correctAnswer = resolveCorrectAnswer(question);
    const questionType = question.type;
    const baseQuestionNumber = resolveQuestionNumber(question, runningCounter + 1);

    const isSplittableMcqMultiple =
      questionType === "MCQ_MULTIPLE" &&
      Array.isArray(correctAnswer) &&
      correctAnswer.length > 1;

    if (isSplittableMcqMultiple) {
      const correctAnswerArr = correctAnswer as unknown[];
      const studentParts = resolveStudentAnswerParts(studentAnswer);
      const remainingCorrect = correctAnswerArr
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0);

      const consumeMatch = (studentEntry: string): boolean => {
        const normalized = normalizeText(studentEntry);
        const matchIndex = remainingCorrect.findIndex(
          (correctEntry) => normalizeText(correctEntry) === normalized,
        );
        if (matchIndex < 0) {
          return false;
        }
        remainingCorrect.splice(matchIndex, 1);
        return true;
      };

      for (let offset = 0; offset < correctAnswerArr.length; offset++) {
        const subQuestionNumber = baseQuestionNumber + offset;
        const studentEntry = studentParts[offset];

        if (!studentEntry || studentEntry.length === 0) {
          const fallbackCorrect = remainingCorrect.shift();
          incorrectItems.push({
            key: `${question.id}::${offset + 1}`,
            questionNumber: subQuestionNumber,
            questionText: question.questionText,
            studentAnswer: "-",
            correctAnswer: fallbackCorrect
              ? fallbackCorrect.toUpperCase()
              : "-",
            reason: "No answer was submitted for this question.",
            isCorrect: false,
          });
        } else if (consumeMatch(studentEntry)) {
          correctCount++;
          incorrectItems.push({
            key: `${question.id}::${offset + 1}`,
            questionNumber: subQuestionNumber,
            questionText: question.questionText,
            studentAnswer: studentEntry.toUpperCase(),
            correctAnswer: studentEntry.toUpperCase(),
            reason: "",
            isCorrect: true,
          });
        } else {
          const fallbackCorrect = remainingCorrect.shift();
          incorrectItems.push({
            key: `${question.id}::${offset + 1}`,
            questionNumber: subQuestionNumber,
            questionText: question.questionText,
            studentAnswer: studentEntry.toUpperCase(),
            correctAnswer: fallbackCorrect
              ? fallbackCorrect.toUpperCase()
              : "-",
            reason: "Your selected answer is different from the expected answer.",
            isCorrect: false,
          });
        }
      }

      totalQuestions += correctAnswerArr.length;
      runningCounter = baseQuestionNumber + correctAnswerArr.length - 1;
    } else {
      totalQuestions++;
      runningCounter = baseQuestionNumber;
      const isCorrect = isAnswerCorrect(studentAnswer, correctAnswer, questionType);

      if (isCorrect) {
        correctCount++;
        incorrectItems.push({
          key: `${question.id}`,
          questionNumber: baseQuestionNumber,
          questionText: question.questionText,
          studentAnswer: formatAnswerValue(studentAnswer, questionType),
          correctAnswer: formatAnswerValue(correctAnswer, questionType),
          reason: "",
          isCorrect: true,
        });
      } else {
        incorrectItems.push({
          key: `${question.id}`,
          questionNumber: baseQuestionNumber,
          questionText: question.questionText,
          studentAnswer: formatAnswerValue(studentAnswer, questionType),
          correctAnswer: formatAnswerValue(correctAnswer, questionType),
          reason: getIncorrectReason(questionType, studentAnswer),
          isCorrect: false,
        });
      }
    }
  }

  return { incorrectItems, totalQuestions, correctCount };
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const parseWritingFeedback = (feedback: unknown): WritingFeedbackSummary | null => {
  if (!isObjectRecord(feedback)) {
    return null;
  }

  const parseScores = (s: unknown): WritingCriterionScores | null => {
    if (!isObjectRecord(s)) return null;
    return {
      task_achievement: Number(s.task_achievement) || 0,
      coherence_cohesion: Number(s.coherence_cohesion) || 0,
      lexical_resource: Number(s.lexical_resource) || 0,
      grammar: Number(s.grammar) || 0,
    };
  };

  const parseTask = (t: unknown, label: string): WritingTaskFeedback | null => {
    if (!isObjectRecord(t)) return null;
    const scores = parseScores(t.scores);
    if (!scores) return null;

    const band = Number(t.overall_band) || 0;

    // Skip tasks with all-zero scores (legacy empty-essay placeholder data)
    const hasAnyScore =
      band > 0 ||
      scores.task_achievement > 0 ||
      scores.coherence_cohesion > 0 ||
      scores.lexical_resource > 0 ||
      scores.grammar > 0;
    if (!hasAnyScore) return null;

    return {
      task: label,
      overall_band: band,
      scores,
      off_topic: t.off_topic === true,
      paragraph_count: typeof t.paragraph_count === "number" ? t.paragraph_count : undefined,
      copied_from_question: toStringArray(t.copied_from_question),
      strengths: toStringArray(t.strengths),
      weaknesses: toStringArray(t.weaknesses),
      band_improvement_advice: toStringArray(t.band_improvement_advice),
    };
  };

  // Parse IeltsWritingSectionResult shape (from AI grading pipeline)
  if (typeof feedback.overall_band === "number" && isObjectRecord(feedback.weighted_scores)) {
    const tasks: WritingTaskFeedback[] = [];
    const taskWeights: Record<string, number> = { "Task 1": 1, "Task 2": 2 };
    const t1 = parseTask(feedback.task1, "Task 1");
    if (t1) tasks.push(t1);
    const t2 = parseTask(feedback.task2, "Task 2");
    if (t2) tasks.push(t2);

    // Aggregate strengths/weaknesses across tasks
    const allStrengths = tasks.flatMap((t) => t.strengths);
    const allWeaknesses = tasks.flatMap((t) => t.weaknesses);

    // Recalculate overall band from valid tasks only (handles legacy data
    // where an empty task was scored as 0 and averaged in).
    let overallBand = feedback.overall_band as number;
    let weightedScores = parseScores(feedback.weighted_scores);

    if (tasks.length > 0) {
      const totalWeight = tasks.reduce((s, t) => s + (taskWeights[t.task] ?? 1), 0);
      const roundBand = (v: number) => Math.round(v * 2) / 2;

      overallBand = roundBand(
        tasks.reduce((s, t) => s + t.overall_band * (taskWeights[t.task] ?? 1), 0) / totalWeight,
      );

      weightedScores = {
        task_achievement: roundBand(
          tasks.reduce((s, t) => s + t.scores.task_achievement * (taskWeights[t.task] ?? 1), 0) / totalWeight,
        ),
        coherence_cohesion: roundBand(
          tasks.reduce((s, t) => s + t.scores.coherence_cohesion * (taskWeights[t.task] ?? 1), 0) / totalWeight,
        ),
        lexical_resource: roundBand(
          tasks.reduce((s, t) => s + t.scores.lexical_resource * (taskWeights[t.task] ?? 1), 0) / totalWeight,
        ),
        grammar: roundBand(
          tasks.reduce((s, t) => s + t.scores.grammar * (taskWeights[t.task] ?? 1), 0) / totalWeight,
        ),
      };
    }

    return {
      overall: null,
      overallBand,
      weightedScores,
      strengths: allStrengths,
      improvements: allWeaknesses,
      tasks,
    };
  }

  // Legacy admin-style shape fallback (overallFeedback, tasks map, etc.)
  const overall =
    typeof feedback.overallFeedback === "string" ? feedback.overallFeedback : null;
  const strengths = toStringArray(feedback.strengths);
  const improvements = toStringArray(feedback.areasForImprovement);

  const tasks: WritingTaskFeedback[] = [];
  if (isObjectRecord(feedback.tasks)) {
    for (const [taskName, taskValue] of Object.entries(feedback.tasks)) {
      if (!isObjectRecord(taskValue)) continue;
      tasks.push({
        task: taskName,
        overall_band: Number(taskValue.bandScore) || 0,
        scores: {
          task_achievement: Number((taskValue.taskAchievement as Record<string, unknown>)?.score) || 0,
          coherence_cohesion: Number((taskValue.coherenceAndCohesion as Record<string, unknown>)?.score) || 0,
          lexical_resource: Number((taskValue.lexicalResource as Record<string, unknown>)?.score) || 0,
          grammar: Number((taskValue.grammaticalRangeAndAccuracy as Record<string, unknown>)?.score) || 0,
        },
        strengths: toStringArray(taskValue.strengths),
        weaknesses: toStringArray(taskValue.areasForImprovement),
        band_improvement_advice: [],
      });
    }
  }

  if (!overall && strengths.length === 0 && improvements.length === 0 && tasks.length === 0) {
    return null;
  }

  return {
    overall,
    overallBand: typeof feedback.bandScore === "number" ? (feedback.bandScore as number) : null,
    weightedScores: null,
    strengths,
    improvements,
    tasks,
  };
};

const EMPTY_SPEAKING_CRITERIA: SpeakingCriterionScores = {
  fluency_coherence: null,
  lexical_resource: null,
  grammatical_range_accuracy: null,
  pronunciation: null,
};

const clampHalfBand = (value: number): number => {
  const normalized = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(9, Math.max(0, normalized));
  return Math.round(clamped * 2) / 2;
};

const parseBandFromUnknown = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9) {
    return null;
  }

  return clampHalfBand(parsed);
};

const averageSpeakingScores = (values: Array<number | null>): number | null => {
  const validValues = values.filter((value): value is number => typeof value === "number");
  if (validValues.length === 0) {
    return null;
  }

  const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
  return clampHalfBand(average);
};

const parseSpeakingScores = (value: unknown): SpeakingCriterionScores => {
  if (!isObjectRecord(value)) {
    return { ...EMPTY_SPEAKING_CRITERIA };
  }

  return {
    fluency_coherence: parseBandFromUnknown(value.fluency_coherence),
    lexical_resource: parseBandFromUnknown(value.lexical_resource),
    grammatical_range_accuracy: parseBandFromUnknown(value.grammatical_range_accuracy),
    pronunciation: parseBandFromUnknown(value.pronunciation),
  };
};

const hasAnySpeakingCriteria = (criteria: SpeakingCriterionScores): boolean => {
  return (
    criteria.fluency_coherence !== null ||
    criteria.lexical_resource !== null ||
    criteria.grammatical_range_accuracy !== null ||
    criteria.pronunciation !== null
  );
};

const hasManualSpeakingFeedback = (feedback: unknown): boolean => {
  return isObjectRecord(feedback) && isObjectRecord(feedback.manualEvaluation);
};

const isStandaloneSpeakingResult = (
  speakingResult: ExamResult | null | undefined,
): boolean => {
  if (!speakingResult) {
    return false;
  }

  return isStandaloneResult(getResultAnswers(speakingResult));
};

const getManualSpeakingBand = (
  speakingResult: ExamResult | null | undefined,
): number | null => {
  if (!speakingResult || isStandaloneSpeakingResult(speakingResult)) {
    return null;
  }

  if (!isObjectRecord(speakingResult.feedback)) {
    return null;
  }

  const manualEvaluation = speakingResult.feedback.manualEvaluation;
  if (!isObjectRecord(manualEvaluation) || manualEvaluation.isManual !== true) {
    return null;
  }

  return parseBandFromUnknown(manualEvaluation.overallBand);
};

const calculateOverallBandForSections = (
  bands: Array<number | null>,
): number | null => {
  if (bands.some((band) => band === null)) {
    return null;
  }

  const typedBands = bands as number[];
  const average = typedBands.reduce((sum, band) => sum + band, 0) / typedBands.length;
  return clampHalfBand(average);
};

const parseSpeakingFeedback = (feedback: unknown): SpeakingFeedbackSummary | null => {
  if (!isObjectRecord(feedback)) {
    return null;
  }

  if (isObjectRecord(feedback.manualEvaluation)) {
    const manualEvaluation = feedback.manualEvaluation as Record<string, unknown>;
    const criteria = parseSpeakingScores(manualEvaluation.scores);
    const comment =
      typeof manualEvaluation.comment === "string" && manualEvaluation.comment.trim().length > 0
        ? manualEvaluation.comment.trim()
        : null;
    const gradedAt =
      typeof manualEvaluation.gradedAt === "string" &&
      manualEvaluation.gradedAt.trim().length > 0
        ? manualEvaluation.gradedAt.trim()
        : null;
    const overallBand =
      parseBandFromUnknown(manualEvaluation.overallBand) ??
      averageSpeakingScores([
        criteria.fluency_coherence,
        criteria.lexical_resource,
        criteria.grammatical_range_accuracy,
        criteria.pronunciation,
      ]);

    if (overallBand !== null || hasAnySpeakingCriteria(criteria) || comment) {
      return {
        overallBand,
        criteria,
        comment,
        gradedAt,
        isManual: manualEvaluation.isManual === true,
      };
    }
  }

  if (Array.isArray(feedback.parts)) {
    const parts = feedback.parts.filter((part): part is Record<string, unknown> =>
      isObjectRecord(part),
    );
    const criteriaByPart = parts.map((part) => {
      const evaluation = isObjectRecord(part.evaluation)
        ? (part.evaluation as Record<string, unknown>)
        : null;
      return parseSpeakingScores(evaluation?.scores);
    });

    const criteria: SpeakingCriterionScores = {
      fluency_coherence: averageSpeakingScores(
        criteriaByPart.map((scores) => scores.fluency_coherence),
      ),
      lexical_resource: averageSpeakingScores(
        criteriaByPart.map((scores) => scores.lexical_resource),
      ),
      grammatical_range_accuracy: averageSpeakingScores(
        criteriaByPart.map((scores) => scores.grammatical_range_accuracy),
      ),
      pronunciation: averageSpeakingScores(
        criteriaByPart.map((scores) => scores.pronunciation),
      ),
    };

    const summaryBand = isObjectRecord(feedback.summary)
      ? parseBandFromUnknown(feedback.summary.overallBand)
      : null;
    const partBands = parts.map((part) => {
      const evaluation = isObjectRecord(part.evaluation)
        ? (part.evaluation as Record<string, unknown>)
        : null;
      return (
        parseBandFromUnknown(part.bandScore) ??
        parseBandFromUnknown(evaluation?.overall_band)
      );
    });

    const overallBand =
      summaryBand ??
      averageSpeakingScores(partBands) ??
      averageSpeakingScores([
        criteria.fluency_coherence,
        criteria.lexical_resource,
        criteria.grammatical_range_accuracy,
        criteria.pronunciation,
      ]);

    if (overallBand !== null || hasAnySpeakingCriteria(criteria)) {
      return {
        overallBand,
        criteria,
        comment: null,
        gradedAt: null,
        isManual: false,
      };
    }
  }

  if (isObjectRecord(feedback.evaluation)) {
    const evaluation = feedback.evaluation as Record<string, unknown>;
    const criteria = parseSpeakingScores(evaluation.scores);
    const overallBand =
      parseBandFromUnknown(evaluation.overall_band) ??
      averageSpeakingScores([
        criteria.fluency_coherence,
        criteria.lexical_resource,
        criteria.grammatical_range_accuracy,
        criteria.pronunciation,
      ]);

    if (overallBand !== null || hasAnySpeakingCriteria(criteria)) {
      return {
        overallBand,
        criteria,
        comment: null,
        gradedAt: null,
        isManual: false,
      };
    }
  }

  return null;
};

const bandColorClass = (score: number): string => {
  if (score >= 7) return "bg-emerald-500";
  if (score >= 6) return "bg-blue-500";
  if (score >= 5) return "bg-amber-500";
  return "bg-red-500";
};

export default function FeedbackPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const queryClient = useQueryClient();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isReportDownloading, setIsReportDownloading] = useState(false);
  const [reportDownloadError, setReportDownloadError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<FeedbackSectionType | null>(null);
  const [isSectionPending, startSectionTransition] = useTransition();
  const router = useRouter();

  const centerQuery = useQuery({
    queryKey: studentQueryKeys.center(user?.centerId || ""),
    queryFn: ({ signal }) => api.getCenter(user!.centerId!, { signal }),
    enabled: !!user?.centerId,
    staleTime: STUDENT_QUERY_TIMINGS.center.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.center.gcTime,
  });

  const resultsQuery = useQuery({
    queryKey: studentQueryKeys.myResults(),
    queryFn: ({ signal }) => api.getMyResults({ signal }),
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.feedback.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.feedback.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const assignmentsQuery = useQuery({
    queryKey: studentQueryKeys.myAssignments(),
    queryFn: ({ signal }) => api.getMyAssignments({ signal }),
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.assignments.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.assignments.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const fullMockSectionIds = useMemo(
    () => buildFullMockSectionIdSet(assignmentsQuery.data ?? []),
    [assignmentsQuery.data],
  );
  const hasLockedOfflineResults = useMemo(() => {
    return (assignmentsQuery.data ?? []).some(
      (assignment) =>
        Boolean(assignment.fullMockSessionId) &&
        assignment.status === "SUBMITTED" &&
        assignment.resultsVisibleToStudent === false,
    );
  }, [assignmentsQuery.data]);

  const fullCdiResults = useMemo(() => {
    return (resultsQuery.data ?? []).filter((result) => {
      const sectionType = result.section?.type as FeedbackSectionType | undefined;
      if (!sectionType || !SECTION_ORDER.includes(sectionType)) {
        return false;
      }

      const resultAnswers = getResultAnswers(result);

      // Speaking can be graded manually on top of an existing result that may
      // be marked as standalone. Keep it visible in Offline Results.
      if (sectionType === "SPEAKING" && hasManualSpeakingFeedback(result.feedback)) {
        return true;
      }

      // If explicitly stamped as standalone (online), exclude from offline results
      if (isStandaloneResult(resultAnswers)) {
        return false;
      }

      // If stamped with a fullMockSessionId, it is definitely an offline result
      if (getResultFullMockSessionId(resultAnswers)) {
        return true;
      }

      // Legacy fallback: use sectionId matching against full-mock assignments
      const sectionId = result.section?.id || result.sectionId;
      return Boolean(sectionId && fullMockSectionIds.has(sectionId));
    });
  }, [resultsQuery.data, fullMockSectionIds]);

  const summaryResultsByType = useMemo(
    () => getLatestResultsByType(fullCdiResults),
    [fullCdiResults],
  );

  const detailQueries = useQueries({
    queries: SECTION_ORDER.map((sectionType) => {
      const summaryResult = summaryResultsByType[sectionType];
      const resultId = summaryResult?.id;

      return {
        queryKey: resultId
          ? studentQueryKeys.result(resultId)
          : (["student", "results", "detail-placeholder", sectionType] as const),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          api.getResult(resultId as string, { signal }),
        enabled: Boolean(resultId && expandedSection === sectionType),
        staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
        gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
        placeholderData: summaryResult,
      };
    }),
  });

  const resultsByType = useMemo(() => {
    return SECTION_ORDER.reduce<Record<FeedbackSectionType, ExamResult | null>>(
      (accumulator, sectionType, index) => {
        const summaryResult = summaryResultsByType[sectionType];
        const detailedResult = detailQueries[index]?.data as ExamResult | null | undefined;
        accumulator[sectionType] = detailedResult ?? summaryResult ?? null;
        return accumulator;
      },
      { ...EMPTY_RESULTS_BY_TYPE },
    );
  }, [detailQueries, summaryResultsByType]);

  const detailLoadingByType = useMemo(() => {
    return SECTION_ORDER.reduce<Record<FeedbackSectionType, boolean>>(
      (accumulator, sectionType, index) => {
        const queryState = detailQueries[index];
        accumulator[sectionType] = Boolean(queryState?.isFetching && !queryState?.data);
        return accumulator;
      },
      {
        LISTENING: false,
        READING: false,
        WRITING: false,
        SPEAKING: false,
      },
    );
  }, [detailQueries]);

  const centerLogo = centerQuery.data?.logo || null;
  const loadingFeedback =
    (resultsQuery.isLoading && !resultsQuery.data) ||
    (assignmentsQuery.isLoading && !assignmentsQuery.data);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  useEffect(() => {
    const resultIds = SECTION_ORDER
      .map((sectionType) => summaryResultsByType[sectionType]?.id)
      .filter((resultId): resultId is string => Boolean(resultId));

    if (resultIds.length === 0) {
      return;
    }

    const timeoutIds = resultIds.map((resultId, index) => {
      return window.setTimeout(() => {
        void queryClient.prefetchQuery({
          queryKey: studentQueryKeys.result(resultId),
          queryFn: ({ signal }) => api.getResult(resultId, { signal }),
          staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
          gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
        });
      }, 200 + index * 200);
    });

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [queryClient, summaryResultsByType]);

  const feedbackMetaByType = useMemo(() => {
    return {
      LISTENING: buildSectionFeedbackMeta(resultsByType.LISTENING),
      READING: buildSectionFeedbackMeta(resultsByType.READING),
    };
  }, [resultsByType]);

  const sectionBandSummary = useMemo(() => {
    const listeningBand = parseBandFromUnknown(resultsByType.LISTENING?.bandScore);
    const readingBand = parseBandFromUnknown(resultsByType.READING?.bandScore);

    const writingFeedback = parseWritingFeedback(resultsByType.WRITING?.feedback);
    const writingBand =
      writingFeedback?.overallBand ??
      parseBandFromUnknown(resultsByType.WRITING?.bandScore);

    const speakingFeedback = parseSpeakingFeedback(resultsByType.SPEAKING?.feedback);
    const speakingBand =
      speakingFeedback?.overallBand ??
      parseBandFromUnknown(resultsByType.SPEAKING?.bandScore);

    const overallBand = calculateOverallBandForSections([
      listeningBand,
      readingBand,
      writingBand,
      speakingBand,
    ]);

    return {
      listeningBand,
      readingBand,
      writingBand,
      speakingBand,
      overallBand,
    };
  }, [resultsByType]);

  const offlineReportData = useMemo<StudentReportData | null>(() => {
    if (!user) {
      return null;
    }

    const listeningResult = resultsByType.LISTENING;
    const readingResult = resultsByType.READING;
    const writingResult = resultsByType.WRITING;
    const speakingResult = resultsByType.SPEAKING;

    const manualSpeakingBand = getManualSpeakingBand(speakingResult);
    if (
      !listeningResult ||
      !readingResult ||
      !writingResult ||
      !speakingResult ||
      manualSpeakingBand === null
    ) {
      return null;
    }

    const speakingResultForReport: ExamResult = {
      ...speakingResult,
      bandScore: manualSpeakingBand,
    };

    const submittedDates = [
      listeningResult.submittedAt,
      readingResult.submittedAt,
      writingResult.submittedAt,
      speakingResult.submittedAt,
    ];

    const latestTestDate = submittedDates.reduce((latest, current) => {
      return new Date(current).getTime() > new Date(latest).getTime()
        ? current
        : latest;
    }, submittedDates[0]);

    return {
      student: user,
      results: {
        listening: listeningResult,
        reading: readingResult,
        writing: writingResult,
        speaking: speakingResultForReport,
      },
      testDate: latestTestDate,
    };
  }, [resultsByType, user]);

  const handleDownloadOfflineReport = async () => {
    if (!offlineReportData || isReportDownloading) {
      return;
    }

    setIsReportDownloading(true);
    setReportDownloadError(null);

    try {
      await generateResultPDF(offlineReportData);
    } catch (error) {
      console.error("Failed to generate offline report PDF", error);
      setReportDownloadError(
        "Could not download report right now. Please try again.",
      );
    } finally {
      setIsReportDownloading(false);
    }
  };

  const toggleSection = (sectionType: FeedbackSectionType) => {
    startSectionTransition(() => {
      setExpandedSection((current) =>
        current === sectionType ? null : sectionType,
      );
    });
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-40 h-14 rounded-xl flex items-center justify-center">
              {centerLogo ? (
                <Image
                  src={centerLogo}
                  alt="Center Logo"
                  width={160}
                  height={56}
                  loading="eager"
                  className="max-h-14 h-auto w-auto object-contain"
                />
              ) : (
                <Image
                  src="/logo.png"
                  alt="logo"
                  width={160}
                  height={56}
                  loading="eager"
                  className="max-h-14 h-auto w-auto object-contain"
                />
              )}
            </div>
          </div>

          <nav className="order-3 w-full md:order-2 md:w-auto">
            <ul className="flex items-center justify-start gap-2 md:gap-4">
              <li>
                <Link
                  href="/dashboard"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/feedback"
                  className="inline-flex rounded-lg bg-black px-3 py-2 text-sm font-medium text-white"
                >
                  Offline Results
                </Link>
              </li>
              <li>
                <Link
                  href="/history"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Online Results
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Pricing
                </Link>
              </li>
            </ul>
          </nav>

          <div className="order-2 md:order-3 flex items-center gap-4">
            <span className="text-gray-600">
              Welcome, {user?.firstName || user?.username}
            </span>
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Offline Results</h2>
            <p className="text-gray-500 mt-1">
              Review your latest Offline Mock at Founders performance.
            </p>
            {hasLockedOfflineResults && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Your teacher has not released offline results yet. Please check again later.
              </div>
            )}
          </div>

          <div className="w-fit min-w-[220px] rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:ml-auto">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-semibold text-gray-600">Overall Band:</p>
              <p className="text-3xl font-extrabold text-gray-900">
                {sectionBandSummary.overallBand !== null
                  ? sectionBandSummary.overallBand.toFixed(1)
                  : "Pending"}
              </p>
            </div>
          </div>
        </div>

        {loadingFeedback ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {SECTION_ORDER.map((sectionType) => {
              const result = resultsByType[sectionType];
              const isExpanded = expandedSection === sectionType;
              const isDetailLoading = detailLoadingByType[sectionType];

              if (!result) {
                return (
                  <section
                    key={sectionType}
                    className="rounded-3xl border border-gray-200 bg-white p-6"
                  >
                    <button
                      type="button"
                      disabled={isSectionPending}
                      onClick={() => toggleSection(sectionType)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-bold text-gray-900">
                          {SECTION_LABELS[sectionType]}
                        </h3>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Not Attempted
                          </span>
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <p className="mt-3 text-sm text-gray-500">
                        Complete this section to receive feedback.
                      </p>
                    )}
                  </section>
                );
              }

              if (sectionType === "WRITING") {
                const writingFeedback = parseWritingFeedback(result.feedback);

                return (
                  <section
                    key={sectionType}
                    className="rounded-3xl border border-gray-200 bg-white p-6"
                  >
                    <button
                      type="button"
                      disabled={isSectionPending}
                      onClick={() => toggleSection(sectionType)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Writing</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            Submitted on {new Date(result.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex rounded-lg bg-(--button-brand-color) px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                            {writingFeedback && writingFeedback.overallBand != null && writingFeedback.overallBand > 0
                              ? `Band ${writingFeedback.overallBand.toFixed(1)}`
                              : typeof result.bandScore === "number"
                                ? `Band ${result.bandScore.toFixed(1)}`
                                : "Pending"}
                          </span>
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <>
                        {isDetailLoading && !writingFeedback ? (
                          <p className="mt-4 text-sm text-gray-500">
                            Loading detailed feedback for this section...
                          </p>
                        ) : writingFeedback ? (
                          <div className="mt-5 space-y-6">
                            {writingFeedback.overall && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                                <p className="text-sm italic text-gray-700 border-l-4 border-gray-300 pl-4 py-1">
                                  &quot;{writingFeedback.overall}&quot;
                                </p>
                              </div>
                            )}

                            {/* Per-task evaluation */}
                            {writingFeedback.tasks.map((task) => {
                              const hasCriteriaScores =
                                task.scores.task_achievement > 0 ||
                                task.scores.coherence_cohesion > 0 ||
                                task.scores.lexical_resource > 0 ||
                                task.scores.grammar > 0;

                              return (
                              <div
                                key={task.task}
                                className="space-y-4"
                              >
                                <h4 className="text-lg font-bold text-gray-900">
                                  {task.task} Evaluation
                                </h4>

                                {!hasCriteriaScores ? (
                                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                                    <p className="text-sm text-amber-800">
                                      {task.overall_band > 0
                                        ? `Overall Band: ${task.overall_band.toFixed(1)} — Detailed criteria breakdown is not available for this result. Please ask your teacher to re-evaluate this submission from the admin panel.`
                                        : "Detailed evaluation is not available for this result. Please ask your teacher to re-evaluate this submission from the admin panel."}
                                    </p>
                                  </div>
                                ) : (
                                  <>
                                {/* Criteria grid */}
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  {([
                                    { label: "Task Achievement", value: task.scores.task_achievement },
                                    { label: "Coherence & Cohesion", value: task.scores.coherence_cohesion },
                                    { label: "Lexical Resource", value: task.scores.lexical_resource },
                                    { label: "Grammatical Range & Accuracy", value: task.scores.grammar },
                                  ] as const).map((criterion) => (
                                    <div
                                      key={criterion.label}
                                      className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                                    >
                                      <div className="flex items-center justify-between">
                                        <h5 className="text-sm font-semibold text-gray-900">
                                          {criterion.label}
                                        </h5>
                                        <span
                                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${bandColorClass(criterion.value)}`}
                                        >
                                          Band {criterion.value}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* Off-topic warning */}
                                {task.off_topic && (
                                  <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                                    <h5 className="text-sm font-bold text-red-800">Off-Topic</h5>
                                    <p className="mt-1 text-sm text-red-700">
                                      Your essay does not address the given {task.task === "Task 1" ? "image/data" : "question"}. In IELTS, an off-topic essay receives a very low Task Achievement score. Make sure to carefully read and respond to the specific prompt provided.
                                    </p>
                                  </div>
                                )}

                                {/* Paragraph count & copied phrases */}
                                {(task.paragraph_count != null && task.paragraph_count > 0 || (task.copied_from_question && task.copied_from_question.length > 0)) && (
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {task.paragraph_count != null && task.paragraph_count > 0 && (
                                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                        <h5 className="text-sm font-semibold text-gray-900">Paragraphs Used</h5>
                                        <p className="mt-1 text-2xl font-bold text-gray-800">{task.paragraph_count}</p>
                                        <p className="mt-0.5 text-xs text-gray-500">
                                          {task.task === "Task 1"
                                            ? "Recommended: 3-4 paragraphs (Intro, Overview, Details)"
                                            : "Recommended: 4-5 paragraphs (Intro, Body 1, Body 2, Conclusion)"}
                                        </p>
                                      </div>
                                    )}
                                    {task.copied_from_question && task.copied_from_question.length > 0 && (
                                      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                                        <h5 className="text-sm font-semibold text-orange-800">Copied from Question</h5>
                                        <p className="mt-1 text-xs text-orange-700">These phrases were copied directly from the question. Paraphrase them to improve your Lexical Resource score.</p>
                                        <ul className="mt-2 space-y-1">
                                          {task.copied_from_question.map((phrase, i) => (
                                            <li key={i} className="text-sm text-gray-700 italic">&ldquo;{phrase}&rdquo;</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Strengths & Weaknesses */}
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  {task.strengths.length > 0 && (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                                      <h5 className="text-sm font-semibold text-emerald-800">
                                        Strengths
                                      </h5>
                                      <ul className="mt-2 space-y-1.5">
                                        {task.strengths.map((point, i) => (
                                          <li
                                            key={i}
                                            className="flex items-start gap-2 text-sm text-gray-700"
                                          >
                                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                            {point}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {task.weaknesses.length > 0 && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                                      <h5 className="text-sm font-semibold text-amber-800">
                                        Areas for Improvement
                                      </h5>
                                      <ul className="mt-2 space-y-1.5">
                                        {task.weaknesses.map((point, i) => (
                                          <li
                                            key={i}
                                            className="flex items-start gap-2 text-sm text-gray-700"
                                          >
                                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                            {point}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>

                                {/* Band improvement advice */}
                                {task.band_improvement_advice.length > 0 && (
                                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                                    <h5 className="text-sm font-semibold text-blue-800">
                                      How to Improve Your Band
                                    </h5>
                                    <ul className="mt-2 space-y-1.5">
                                      {task.band_improvement_advice.map((point, i) => (
                                        <li
                                          key={i}
                                          className="flex items-start gap-2 text-sm text-gray-700"
                                        >
                                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                          {point}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                  </>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-gray-500">
                            Writing feedback is being prepared. Please check back shortly.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                );
              }

              if (sectionType === "SPEAKING") {
                const speakingFeedback = parseSpeakingFeedback(result.feedback);
                const speakingCriteria =
                  speakingFeedback?.criteria ?? EMPTY_SPEAKING_CRITERIA;
                const hasCriteria = hasAnySpeakingCriteria(speakingCriteria);

                return (
                  <section
                    key={sectionType}
                    className="rounded-3xl border border-gray-200 bg-white p-6"
                  >
                    <button
                      type="button"
                      disabled={isSectionPending}
                      onClick={() => toggleSection(sectionType)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Speaking</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            Submitted on {new Date(result.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex rounded-lg bg-(--button-brand-color) px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                            {speakingFeedback &&
                            speakingFeedback.overallBand != null &&
                            speakingFeedback.overallBand > 0
                              ? `Band ${speakingFeedback.overallBand.toFixed(1)}`
                              : typeof result.bandScore === "number"
                                ? `Band ${result.bandScore.toFixed(1)}`
                                : "Pending"}
                          </span>
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <>
                        {isDetailLoading && !speakingFeedback ? (
                          <p className="mt-4 text-sm text-gray-500">
                            Loading detailed feedback for this section...
                          </p>
                        ) : speakingFeedback ? (
                          <div className="mt-5 space-y-4">
                            {speakingFeedback.isManual && (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  Manually graded
                                </p>
                                <p className="mt-1 text-sm text-gray-700">
                                  {speakingFeedback.gradedAt
                                    ? `Updated on ${new Date(speakingFeedback.gradedAt).toLocaleString()}`
                                    : "Graded by your teacher."}
                                </p>
                              </div>
                            )}

                            {hasCriteria ? (
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {([
                                  {
                                    label: "Fluency & Coherence",
                                    value: speakingCriteria.fluency_coherence,
                                  },
                                  {
                                    label: "Lexical Resource",
                                    value: speakingCriteria.lexical_resource,
                                  },
                                  {
                                    label: "Grammar Range & Accuracy",
                                    value: speakingCriteria.grammatical_range_accuracy,
                                  },
                                  {
                                    label: "Pronunciation",
                                    value: speakingCriteria.pronunciation,
                                  },
                                ] as const).map((criterion) => (
                                  <div
                                    key={criterion.label}
                                    className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                                  >
                                    <div className="flex items-center justify-between">
                                      <h5 className="text-sm font-semibold text-gray-900">
                                        {criterion.label}
                                      </h5>
                                      {criterion.value !== null ? (
                                        <span
                                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${bandColorClass(criterion.value)}`}
                                        >
                                          Band {criterion.value.toFixed(1)}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-bold text-gray-600">
                                          Pending
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">
                                Detailed criteria scores are being prepared. Please
                                check back shortly.
                              </p>
                            )}

                            {speakingFeedback.comment && (
                              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                                <h4 className="text-sm font-semibold text-blue-800">
                                  Teacher Comment
                                </h4>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                                  {speakingFeedback.comment}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-gray-500">
                            Speaking feedback is being prepared. Please check back
                            shortly.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                );
              }

              const sectionMeta = feedbackMetaByType[sectionType];
              const incorrectItems = sectionMeta.incorrectItems;
              const totalQuestions = sectionMeta.totalQuestions;
              const correctCount = sectionMeta.isReady ? sectionMeta.correctCount : null;

              return (
                <section
                  key={sectionType}
                  className="rounded-3xl border border-gray-200 bg-white p-6"
                >
                  <button
                    type="button"
                    disabled={isSectionPending}
                    onClick={() => toggleSection(sectionType)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {SECTION_LABELS[sectionType]}
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Submitted on {new Date(result.submittedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700">
                          {sectionMeta.isReady && correctCount !== null
                            ? `${correctCount}/${totalQuestions} correct`
                            : isDetailLoading
                              ? "Loading"
                              : "Detailed"}
                        </span>
                        <span className="inline-flex rounded-lg bg-(--button-brand-color) px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                          {typeof result.bandScore === "number"
                            ? `Band ${result.bandScore.toFixed(1)}`
                            : `Score ${result.score}`}
                        </span>
                        <svg
                          className={`h-5 w-5 text-gray-400 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <>
                      {isDetailLoading ? (
                        <p className="mt-4 text-sm text-gray-500">
                          Loading detailed feedback for this section...
                        </p>
                      ) : !sectionMeta.isReady ? (
                        <p className="mt-4 text-sm text-gray-500">
                          Detailed feedback is being prepared. Please check back shortly.
                        </p>
                      ) : incorrectItems.filter((item) => !item.isCorrect).length === 0 ? (
                        <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-700">
                          Great work. No incorrect responses found in your latest {" "}
                          {SECTION_LABELS[sectionType].toLowerCase()} attempt.
                        </p>
                      ) : (
                        <div className="mt-5 space-y-3">
                          {incorrectItems.map((item) => (
                            <article
                              key={item.key}
                              className={`rounded-xl border p-4 ${
                                item.isCorrect
                                  ? "border-emerald-100 bg-emerald-50/40"
                                  : "border-red-100 bg-red-50/40"
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-900">
                                  Q{item.questionNumber}. {item.questionText}
                                </p>
                                <span
                                  className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                                    item.isCorrect
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {item.isCorrect ? "Correct" : "Incorrect"}
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Your answer
                                  </p>
                                  <p
                                    className={`mt-1 text-sm font-medium ${
                                      item.isCorrect ? "text-emerald-700" : "text-red-700"
                                    }`}
                                  >
                                    {item.studentAnswer}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Correct answer
                                  </p>
                                  <p className="mt-1 text-sm font-medium text-gray-800">
                                    {item.correctAnswer}
                                  </p>
                                </div>
                              </div>

                              {!item.isCorrect && (
                                <p className="mt-3 text-sm text-red-700">Why: {item.reason}</p>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}

            <section className="rounded-3xl border border-gray-200 bg-white p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Download Results</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Download your Offline Results report after Speaking is manually
                    graded.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleDownloadOfflineReport()}
                  disabled={!offlineReportData || isReportDownloading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--button-brand-color) px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--button-brand-hover-color) disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  {isReportDownloading ? "Preparing PDF..." : "Download Results"}
                </button>
              </div>

              {!offlineReportData && (
                <p className="mt-3 text-xs text-gray-500">
                  Download unlocks after Listening, Reading, Writing, and manually
                  graded Speaking are ready.
                </p>
              )}

              {reportDownloadError && (
                <p className="mt-3 text-xs text-red-600">{reportDownloadError}</p>
              )}
            </section>
          </div>
        )}
      </main>

      <ConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={logout}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmText="Sign Out"
        variant="danger"
      />
    </div>
  );
}
