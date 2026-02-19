"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import { ExamAssignment, ExamResult, ExamSectionType, Passage, Question } from "@/types";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type HistorySectionType = Extract<ExamSectionType, "LISTENING" | "READING" | "WRITING">;
type ScoreFilter = "ALL" | "BELOW_40" | "BETWEEN_40_70" | "ABOVE_70";

interface SectionMetadata {
  questions: Question[];
  passages: Passage[];
}

interface AttemptListItem {
  result: ExamResult;
  sectionType: HistorySectionType;
  sectionLabel: string;
  attempt: number;
  testType: string;
  isSplitSection: boolean;
  title: string;
  attemptIdLabel: string;
  scorePercent: number;
  correctDisplay: string;
  completedAtDisplay: string;
  timeSpentDisplay: string;
  submittedAtMs: number;
}

const SECTION_ORDER: HistorySectionType[] = ["READING", "LISTENING", "WRITING"];
const PAGE_SIZE = 8;

const SECTION_LABELS: Record<HistorySectionType, string> = {
  READING: "Reading",
  LISTENING: "Listening",
  WRITING: "Writing",
};

const SCORE_FILTER_OPTIONS: Array<{ value: ScoreFilter; label: string }> = [
  { value: "ALL", label: "All scores" },
  { value: "BELOW_40", label: "Below 40%" },
  { value: "BETWEEN_40_70", label: "40% - 70%" },
  { value: "ABOVE_70", label: "Above 70%" },
];

const isHistorySectionType = (
  sectionType: ExamSectionType | undefined,
): sectionType is HistorySectionType => {
  return sectionType === "READING" || sectionType === "LISTENING" || sectionType === "WRITING";
};

const buildFullMockOnlySectionIdSet = (assignments: ExamAssignment[]) => {
  const fullMockSectionIds = new Set<string>();
  const standaloneSectionIds = new Set<string>();

  for (const assignment of assignments) {
    const sectionId = assignment.section?.id;
    if (!sectionId) {
      continue;
    }

    if (assignment.fullMockSessionId) {
      fullMockSectionIds.add(sectionId);
    } else {
      standaloneSectionIds.add(sectionId);
    }
  }

  return new Set(
    [...fullMockSectionIds].filter((sectionId) => !standaloneSectionIds.has(sectionId)),
  );
};

const hasAnswerValue = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return true;
};

const getAnsweredKeys = (answers: Record<string, unknown> | undefined): string[] => {
  return Object.entries(answers || {})
    .filter(([key, value]) => !key.startsWith("_") && hasAnswerValue(value))
    .map(([key]) => key);
};

const getResultAnswers = (result: ExamResult): Record<string, unknown> => {
  return (result.answers || {}) as Record<string, unknown>;
};

const getStoredAttemptType = (answers: Record<string, unknown>): string => {
  return typeof answers._attemptType === "string" ? answers._attemptType.trim() : "";
};

const isStoredSplitAttempt = (attemptType: string): boolean => {
  return /^part\s+\d+$/i.test(attemptType) || /^task\s+\d+$/i.test(attemptType);
};

const getStoredAttemptQuestionCount = (
  answers: Record<string, unknown>,
): number | null => {
  const value = answers._attemptQuestionCount;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
};

const isStandaloneResult = (answers: Record<string, unknown>): boolean => {
  if (answers._attemptMode === "standalone") {
    return true;
  }

  return answers._isStandalone === true;
};

const getResultFullMockSessionId = (answers: Record<string, unknown>): string => {
  if (typeof answers._fullMockSessionId !== "string") {
    return "";
  }

  return answers._fullMockSessionId.trim();
};

const resolveReadingTestType = (
  answeredKeys: string[],
  metadata?: SectionMetadata,
): string => {
  if (!metadata || answeredKeys.length === 0) {
    return "Full";
  }

  const partCount = Math.min(metadata.passages.length, 4);

  for (let index = 0; index < partCount; index += 1) {
    const passage = metadata.passages[index];
    const questionIds = new Set(
      metadata.questions
        .filter((question) => question.passageId === passage.id)
        .map((question) => question.id),
    );

    if (questionIds.size === 0) {
      continue;
    }

    const belongsToPart = answeredKeys.every((answerKey) => questionIds.has(answerKey));
    if (belongsToPart) {
      return `Part ${index + 1}`;
    }
  }

  return "Full";
};

const resolveListeningTestType = (
  answeredKeys: string[],
  metadata?: SectionMetadata,
): string => {
  if (!metadata || answeredKeys.length === 0 || metadata.questions.length === 0) {
    return "Full";
  }

  const partCount = 4;
  const questionsPerPart = Math.ceil(metadata.questions.length / partCount);

  for (let index = 0; index < partCount; index += 1) {
    const start = index * questionsPerPart;
    const end = Math.min(start + questionsPerPart, metadata.questions.length);
    const questionIds = new Set(
      metadata.questions.slice(start, end).map((question) => question.id),
    );

    if (questionIds.size === 0) {
      continue;
    }

    const belongsToPart = answeredKeys.every((answerKey) => questionIds.has(answerKey));
    if (belongsToPart) {
      return `Part ${index + 1}`;
    }
  }

  return "Full";
};

const resolveWritingTestType = (
  answeredKeys: string[],
  metadata?: SectionMetadata,
): string => {
  if (answeredKeys.length === 0) {
    return "Full";
  }

  const normalizedKeys = answeredKeys.map((key) => key.toLowerCase());
  const task1QuestionId = metadata?.questions[0]?.id;
  const task2QuestionId = metadata?.questions[1]?.id;

  const hasTask1 =
    normalizedKeys.includes("w1") ||
    normalizedKeys.includes("task1") ||
    (task1QuestionId ? answeredKeys.includes(task1QuestionId) : false);
  const hasTask2 =
    normalizedKeys.includes("w2") ||
    normalizedKeys.includes("task2") ||
    (task2QuestionId ? answeredKeys.includes(task2QuestionId) : false);

  if (hasTask1 && !hasTask2) {
    return "Task 1";
  }

  if (hasTask2 && !hasTask1) {
    return "Task 2";
  }

  return "Full";
};

const resolveTestType = (
  sectionType: HistorySectionType,
  result: ExamResult,
  metadata?: SectionMetadata,
  isSplitSection = false,
): string => {
  const answers = (result.answers || {}) as Record<string, unknown>;
  const storedAttemptType =
    typeof answers._attemptType === "string" ? answers._attemptType.trim() : "";

  if (/^full$/i.test(storedAttemptType)) {
    return "Full";
  }

  const storedPartMatch = storedAttemptType.match(/^part\s+(\d+)$/i);
  if (storedPartMatch) {
    return `Part ${Number(storedPartMatch[1])}`;
  }

  const storedTaskMatch = storedAttemptType.match(/^task\s+(\d+)$/i);
  if (storedTaskMatch) {
    return `Task ${Number(storedTaskMatch[1])}`;
  }

  if (!isSplitSection) {
    return "Full";
  }

  const answeredKeys = getAnsweredKeys(answers);

  if (sectionType === "READING") {
    return resolveReadingTestType(answeredKeys, metadata);
  }

  if (sectionType === "LISTENING") {
    return resolveListeningTestType(answeredKeys, metadata);
  }

  return resolveWritingTestType(answeredKeys, metadata);
};

const getExplicitPartOrTask = (attemptType: string, label: "part" | "task"): number | null => {
  const match = attemptType.match(new RegExp(`^${label}\\s+(\\d+)$`, "i"));
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const resolveQuestionsForAttempt = ({
  sectionType,
  allQuestions,
  passages,
  answers,
  attemptType,
}: {
  sectionType: HistorySectionType;
  allQuestions: Question[];
  passages: Passage[];
  answers: Record<string, unknown>;
  attemptType: string;
}): Question[] => {
  if (allQuestions.length === 0) {
    return allQuestions;
  }

  const normalizedAttemptType = attemptType.trim().toLowerCase();
  const hasAttemptTypeHint = normalizedAttemptType.length > 0;
  if (normalizedAttemptType === "full") {
    return allQuestions;
  }

  const answeredKeys = getAnsweredKeys(answers);

  if (sectionType === "READING") {
    const explicitPart = getExplicitPartOrTask(attemptType, "part");
    let partIndex = explicitPart ? explicitPart - 1 : null;

    if (partIndex === null && !hasAttemptTypeHint && answeredKeys.length > 0) {
      for (let index = 0; index < passages.length; index += 1) {
        const passageId = passages[index]?.id;
        const questionIds = new Set(
          allQuestions
            .filter((question) => question.passageId === passageId)
            .map((question) => question.id),
        );

        if (questionIds.size === 0) {
          continue;
        }

        if (answeredKeys.every((answerKey) => questionIds.has(answerKey))) {
          partIndex = index;
          break;
        }
      }
    }

    if (partIndex !== null && partIndex >= 0 && partIndex < passages.length) {
      const passageId = passages[partIndex]?.id;
      const scopedQuestions = allQuestions.filter(
        (question) => question.passageId === passageId,
      );

      if (scopedQuestions.length > 0) {
        return scopedQuestions;
      }
    }

    return allQuestions;
  }

  if (sectionType === "LISTENING") {
    const partCount = 4;
    const questionsPerPart = Math.ceil(allQuestions.length / partCount);
    const explicitPart = getExplicitPartOrTask(attemptType, "part");
    let partIndex = explicitPart ? explicitPart - 1 : null;

    if (partIndex === null && !hasAttemptTypeHint && answeredKeys.length > 0) {
      for (let index = 0; index < partCount; index += 1) {
        const start = index * questionsPerPart;
        const end = Math.min(start + questionsPerPart, allQuestions.length);
        const questionIds = new Set(
          allQuestions.slice(start, end).map((question) => question.id),
        );

        if (questionIds.size === 0) {
          continue;
        }

        if (answeredKeys.every((answerKey) => questionIds.has(answerKey))) {
          partIndex = index;
          break;
        }
      }
    }

    if (partIndex !== null && partIndex >= 0 && partIndex < partCount) {
      const start = partIndex * questionsPerPart;
      const end = Math.min(start + questionsPerPart, allQuestions.length);
      return allQuestions.slice(start, end);
    }

    return allQuestions;
  }

  const explicitTask = getExplicitPartOrTask(attemptType, "task");
  if (explicitTask === 1 && allQuestions[0]) {
    return [allQuestions[0]];
  }

  if (explicitTask === 2 && allQuestions[1]) {
    return [allQuestions[1]];
  }

  if (hasAttemptTypeHint) {
    return allQuestions;
  }

  const normalizedKeys = answeredKeys.map((key) => key.toLowerCase());
  const task1QuestionId = allQuestions[0]?.id;
  const task2QuestionId = allQuestions[1]?.id;

  const hasTask1 =
    normalizedKeys.includes("w1") ||
    normalizedKeys.includes("task1") ||
    (task1QuestionId ? answeredKeys.includes(task1QuestionId) : false);
  const hasTask2 =
    normalizedKeys.includes("w2") ||
    normalizedKeys.includes("task2") ||
    (task2QuestionId ? answeredKeys.includes(task2QuestionId) : false);

  if (hasTask1 && !hasTask2 && allQuestions[0]) {
    return [allQuestions[0]];
  }

  if (hasTask2 && !hasTask1 && allQuestions[1]) {
    return [allQuestions[1]];
  }

  return allQuestions;
};

const getQuestionPoints = (question: Question): number => {
  const points = (question as { points?: unknown }).points;
  if (typeof points === "number" && Number.isFinite(points) && points > 0) {
    return points;
  }

  return 1;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const getScorePercent = (result: ExamResult) => {
  const score = Number(result.score);
  const totalScore = Number(result.totalScore);

  if (Number.isFinite(score) && Number.isFinite(totalScore) && totalScore > 0) {
    return clamp((score / totalScore) * 100, 0, 100);
  }

  if (typeof result.bandScore === "number" && Number.isFinite(result.bandScore)) {
    return clamp((result.bandScore / 9) * 100, 0, 100);
  }

  return 0;
};

const formatPercent = (value: number) => `${Math.round(value)}%`;

const formatAttemptId = (id: string) => {
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 5) {
    return `#${digits.slice(-5)}`;
  }

  return `#${id.slice(0, 8).toUpperCase()}`;
};

const formatCompletedAt = (submittedAt: string) => {
  return new Date(submittedAt).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDurationMs = (durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "<1 min";
  }

  const totalMinutes = Math.round(durationMs / 60000);
  if (totalMinutes <= 0) {
    return "<1 min";
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

const resolveTimeSpentDisplay = (result: ExamResult, assignment?: ExamAssignment) => {
  const answers = (result.answers || {}) as Record<string, unknown>;
  const durationSeconds =
    typeof answers._durationSeconds === "number"
      ? answers._durationSeconds
      : typeof answers._timeSpentSeconds === "number"
      ? answers._timeSpentSeconds
      : null;

  if (typeof durationSeconds === "number" && durationSeconds > 0) {
    return formatDurationMs(durationSeconds * 1000);
  }

  if (!assignment?.startTime) {
    return "<1 min";
  }

  const startedAtMs = new Date(assignment.startTime).getTime();
  const submittedAtMs = new Date(result.submittedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(submittedAtMs)) {
    return "<1 min";
  }

  const elapsedMs = submittedAtMs - startedAtMs;
  const sectionDurationMinutes = result.section?.duration ?? 60;
  const maxReasonableMs = (sectionDurationMinutes + 5) * 60000;

  if (elapsedMs <= 0 || elapsedMs > maxReasonableMs) {
    return "<1 min";
  }

  return formatDurationMs(elapsedMs);
};

const scoreMatchesFilter = (scorePercent: number, filter: ScoreFilter) => {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "BELOW_40") {
    return scorePercent < 40;
  }

  if (filter === "BETWEEN_40_70") {
    return scorePercent >= 40 && scorePercent <= 70;
  }

  return scorePercent > 70;
};

export default function HistoryPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const needsLegacyAssignmentMetadata = useMemo(() => {
    const results = resultsQuery.data ?? [];

    return results.some((result) => {
      if (!isHistorySectionType(result.section?.type)) {
        return false;
      }

      const answers = getResultAnswers(result);
      const storedAttemptType = getStoredAttemptType(answers);

      const hasModeMarker = typeof answers._attemptMode === "string";
      const hasFullMockMarker = Object.prototype.hasOwnProperty.call(
        answers,
        "_fullMockSessionId",
      );
      const hasAttemptType = storedAttemptType.length > 0;
      const needsAttemptQuestionCount = isStoredSplitAttempt(storedAttemptType);
      const hasAttemptQuestionCount =
        getStoredAttemptQuestionCount(answers) !== null;

      if (!hasModeMarker || !hasFullMockMarker || !hasAttemptType) {
        return true;
      }

      if (needsAttemptQuestionCount && !hasAttemptQuestionCount) {
        return true;
      }

      return false;
    });
  }, [resultsQuery.data]);

  const assignmentsQuery = useQuery({
    queryKey: studentQueryKeys.myAssignments(),
    queryFn: ({ signal }) => api.getMyAssignments({ signal }),
    enabled: !!user?.id && needsLegacyAssignmentMetadata,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: STUDENT_QUERY_TIMINGS.assignments.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.assignments.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const centerLogo = centerQuery.data?.logo || null;

  const fullMockOnlySectionIds = useMemo(
    () => buildFullMockOnlySectionIdSet(assignmentsQuery.data ?? []),
    [assignmentsQuery.data],
  );

  const sectionMetadataById = useMemo(() => {
    const metadata = new Map<string, SectionMetadata>();

    for (const assignment of assignmentsQuery.data ?? []) {
      const section = assignment.section;
      if (!section || !isHistorySectionType(section.type) || metadata.has(section.id)) {
        continue;
      }

      metadata.set(section.id, {
        questions: (section.questions || []) as Question[],
        passages: (section.passages || []) as Passage[],
      });
    }

    return metadata;
  }, [assignmentsQuery.data]);

  const standaloneAssignmentBySectionId = useMemo(() => {
    const assignmentMap = new Map<string, ExamAssignment>();

    for (const assignment of assignmentsQuery.data ?? []) {
      const section = assignment.section;
      if (!section || assignment.fullMockSessionId || !isHistorySectionType(section.type)) {
        continue;
      }

      assignmentMap.set(section.id, assignment);
    }

    return assignmentMap;
  }, [assignmentsQuery.data]);

  const splitStandaloneSectionIds = useMemo(() => {
    const grouped: Record<HistorySectionType, ExamAssignment[]> = {
      READING: [],
      LISTENING: [],
      WRITING: [],
    };

    for (const assignment of assignmentsQuery.data ?? []) {
      const section = assignment.section;
      if (!section || assignment.fullMockSessionId || !isHistorySectionType(section.type)) {
        continue;
      }

      grouped[section.type].push(assignment);
    }

    const splitSectionIds = new Set<string>();

    for (const sectionType of SECTION_ORDER) {
      const sorted = [...grouped[sectionType]].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );

      const splitAssignment = sorted[1];
      const splitSectionId = splitAssignment?.section?.id || splitAssignment?.sectionId;
      if (splitSectionId) {
        splitSectionIds.add(splitSectionId);
      }
    }

    return splitSectionIds;
  }, [assignmentsQuery.data]);

  const selfStudyResults = useMemo(() => {
    return (resultsQuery.data ?? []).filter((result) => {
      const sectionType = result.section?.type;
      if (!isHistorySectionType(sectionType)) {
        return false;
      }

      const resultAnswers = getResultAnswers(result);
      if (isStandaloneResult(resultAnswers)) {
        return true;
      }

      if (getResultFullMockSessionId(resultAnswers)) {
        return false;
      }

      const sectionId = result.section?.id || result.sectionId;
      if (!sectionId) {
        return true;
      }

      return !fullMockOnlySectionIds.has(sectionId);
    });
  }, [resultsQuery.data, fullMockOnlySectionIds]);

  const allAttempts = useMemo<AttemptListItem[]>(() => {
    const attempts: AttemptListItem[] = [];

    for (const sectionType of SECTION_ORDER) {
      const sectionResults = selfStudyResults
        .filter((result) => result.section?.type === sectionType)
        .sort(
          (left, right) =>
            new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
        );

      sectionResults.forEach((result, index) => {
        const sectionId = result.section?.id || result.sectionId;
        const metadata = sectionId ? sectionMetadataById.get(sectionId) : undefined;
        const assignment = sectionId ? standaloneAssignmentBySectionId.get(sectionId) : undefined;
        const resultAnswers = getResultAnswers(result);
        const storedAttemptType = getStoredAttemptType(resultAnswers);
        const hasStoredSplitAttempt = isStoredSplitAttempt(storedAttemptType);
        const isSplitSection =
          hasStoredSplitAttempt ||
          Boolean(sectionId && splitStandaloneSectionIds.has(sectionId));
        const testType = resolveTestType(sectionType, result, metadata, isSplitSection);

        const storedAttemptQuestionCount = getStoredAttemptQuestionCount(resultAnswers);

        const scopedQuestions =
          isSplitSection && storedAttemptQuestionCount === null
            ? resolveQuestionsForAttempt({
                sectionType,
                allQuestions: metadata?.questions || [],
                passages: metadata?.passages || [],
                answers: resultAnswers,
                attemptType: testType,
              })
            : metadata?.questions || [];

        const scopedTotalScore =
          storedAttemptQuestionCount ??
          scopedQuestions.reduce((sum, question) => sum + getQuestionPoints(question), 0);

        const score = Number(result.score);
        const totalScore = Number(result.totalScore);
        const hasObjectiveScore = Number.isFinite(score) && Number.isFinite(totalScore) && totalScore > 0;
        const isObjectiveSection = sectionType === "READING" || sectionType === "LISTENING";
        const effectiveTotalScore =
          isObjectiveSection && scopedTotalScore > 0 ? scopedTotalScore : totalScore;

        let scorePercent = getScorePercent(result);
        if (hasObjectiveScore && effectiveTotalScore > 0) {
          scorePercent = clamp((score / effectiveTotalScore) * 100, 0, 100);
        }

        let correctDisplay = "Score pending";
        if (hasObjectiveScore && effectiveTotalScore > 0) {
          correctDisplay = `${Math.round(score)}/${Math.round(effectiveTotalScore)} correct`;
        } else if (typeof result.bandScore === "number") {
          correctDisplay = `Band ${result.bandScore.toFixed(1)}`;
        }

        attempts.push({
          result,
          sectionType,
          sectionLabel: SECTION_LABELS[sectionType],
          attempt: index + 1,
          testType,
          isSplitSection,
          title: result.section?.title || `${SECTION_LABELS[sectionType]} practice test`,
          attemptIdLabel: formatAttemptId(result.id),
          scorePercent,
          correctDisplay,
          completedAtDisplay: formatCompletedAt(result.submittedAt),
          timeSpentDisplay: resolveTimeSpentDisplay(result, assignment),
          submittedAtMs: new Date(result.submittedAt).getTime(),
        });
      });
    }

    return attempts.sort((left, right) => right.submittedAtMs - left.submittedAtMs);
  }, [
    selfStudyResults,
    sectionMetadataById,
    standaloneAssignmentBySectionId,
    splitStandaloneSectionIds,
  ]);

  const filteredAttempts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return allAttempts.filter((attempt) => {
      if (!scoreMatchesFilter(attempt.scorePercent, scoreFilter)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [
        attempt.title,
        attempt.attemptIdLabel,
        attempt.result.id,
        attempt.sectionLabel,
        attempt.testType,
        attempt.sectionType,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [allAttempts, searchQuery, scoreFilter]);

  const attemptsCount = filteredAttempts.length;
  const avgScore = useMemo(() => {
    if (filteredAttempts.length === 0) {
      return 0;
    }

    const total = filteredAttempts.reduce((sum, attempt) => sum + attempt.scorePercent, 0);
    return total / filteredAttempts.length;
  }, [filteredAttempts]);

  const bestScore = useMemo(() => {
    if (filteredAttempts.length === 0) {
      return 0;
    }

    return filteredAttempts.reduce(
      (best, attempt) => Math.max(best, attempt.scorePercent),
      0,
    );
  }, [filteredAttempts]);

  const totalPages = Math.max(1, Math.ceil(filteredAttempts.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedAttempts = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return filteredAttempts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredAttempts, safeCurrentPage]);

  const loadingHistory =
    (resultsQuery.isLoading && !resultsQuery.data) ||
    (needsLegacyAssignmentMetadata &&
      assignmentsQuery.isLoading &&
      !assignmentsQuery.data);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f4f5] flex flex-col">
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
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Feedback
                </Link>
              </li>
              <li>
                <Link
                  href="/history"
                  className="inline-flex rounded-lg bg-black px-3 py-2 text-sm font-medium text-white"
                >
                  History
                </Link>
              </li>
            </ul>
          </nav>

          <div className="order-2 md:order-3 flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.firstName || user?.username}</span>
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1">
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl bg-[#f2f2f3] border border-[#e3e3e6] p-5 lg:min-h-[620px]">
            <div className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
              <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5h18M6 12h12M10 19h4" />
              </svg>
              Filters
            </div>

            <div className="mt-5">
              <p className="text-sm font-semibold text-gray-700">Search by title / ID</p>
              <div className="mt-2 relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.3-4.3m1.6-5a7.2 7.2 0 11-14.4 0 7.2 7.2 0 0114.4 0z" />
                </svg>
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Type to search..."
                  className="w-full rounded-xl border border-[#d9d9dc] bg-white py-2.5 pl-10 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                />
              </div>
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-gray-700">Score range</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {SCORE_FILTER_OPTIONS.map((option) => {
                  const isActive = scoreFilter === option.value;

                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        setScoreFilter(option.value);
                        setCurrentPage(1);
                      }}
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                        isActive
                          ? "bg-red-50 text-red-600 border border-red-300"
                          : "bg-white text-gray-500 border border-[#d9d9dc] hover:border-gray-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-7">
              <p className="text-sm font-semibold text-gray-700">This page summary</p>
              <div className="mt-3 rounded-xl border border-[#d9d9dc] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-700">
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                    Attempts
                  </span>
                  <span className="font-semibold text-gray-900">{attemptsCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-700">
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
                    </svg>
                    Avg score
                  </span>
                  <span className="font-semibold text-gray-900">{formatPercent(avgScore)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-700">
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.092 3.36a1 1 0 00.95.69h3.532c.969 0 1.371 1.24.588 1.81l-2.858 2.077a1 1 0 00-.364 1.118l1.092 3.36c.3.921-.755 1.688-1.54 1.118l-2.858-2.077a1 1 0 00-1.176 0l-2.858 2.077c-.784.57-1.838-.197-1.539-1.118l1.091-3.36a1 1 0 00-.363-1.118L2.49 8.787c-.783-.57-.38-1.81.588-1.81H6.61a1 1 0 00.95-.69l1.092-3.36z" />
                    </svg>
                    Best score
                  </span>
                  <span className="font-semibold text-gray-900">{formatPercent(bestScore)}</span>
                </div>
              </div>
            </div>
          </aside>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-3xl font-semibold text-gray-900">Your attempts</h2>
                <p className="mt-1 text-sm text-gray-500">
                  You have completed {attemptsCount} {attemptsCount === 1 ? "attempt" : "attempts"} in total.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 text-sm text-gray-500">
                <span>
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                  disabled={safeCurrentPage <= 1}
                  className="h-8 w-8 rounded-md border border-[#d9d9dc] bg-white text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <svg className="mx-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  className="h-8 w-8 rounded-md border border-[#d9d9dc] bg-white text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <svg className="mx-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {loadingHistory ? (
              <div className="mt-8 rounded-2xl border border-[#e3e3e6] bg-white p-10 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
              </div>
            ) : allAttempts.length === 0 ? (
              <section className="mt-6 rounded-2xl border border-[#e3e3e6] bg-white p-8 text-center">
                <h3 className="text-lg font-semibold text-gray-900">No self-study attempts yet</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Complete Reading, Listening, or Writing standalone tests and your history will appear here.
                </p>
              </section>
            ) : filteredAttempts.length === 0 ? (
              <section className="mt-6 rounded-2xl border border-[#e3e3e6] bg-white p-8 text-center">
                <h3 className="text-lg font-semibold text-gray-900">No attempts match this filter</h3>
                <p className="mt-2 text-sm text-gray-500">Try a different search keyword or score range.</p>
              </section>
            ) : (
              <div className="mt-6 space-y-4">
                {paginatedAttempts.map((attempt) => (
                  <article
                    key={attempt.result.id}
                    className="rounded-2xl border border-[#e3e3e6] bg-white p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-2xl font-semibold text-gray-900 truncate">{attempt.title}</h3>
                        <span className="inline-flex rounded-full border border-[#d9d9dc] bg-white px-2.5 py-1 text-xs font-medium text-gray-700">
                          {attempt.testType}
                        </span>
                        <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
                          {formatPercent(attempt.scorePercent)}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-gray-500">
                        Attempt ID: {attempt.attemptIdLabel} · Attempt {attempt.attempt} · {attempt.sectionLabel}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {attempt.correctDisplay}
                        </span>
                        <span className="text-gray-300">•</span>
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                          </svg>
                          Completed at {attempt.completedAtDisplay}
                        </span>
                        <span className="text-gray-300">•</span>
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Time spent: {attempt.timeSpentDisplay}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        router.push(
                          `/history/review/${attempt.result.id}?type=${encodeURIComponent(attempt.testType)}&split=${attempt.isSplitSection ? "1" : "0"}`,
                        )
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d9d9dc] bg-[#f7f7f8] px-4 py-2 text-sm font-medium text-gray-700 hover:bg-[#efeff1] transition-colors"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Review attempt
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
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
