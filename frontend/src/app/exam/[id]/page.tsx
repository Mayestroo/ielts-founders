"use client";

import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { ExamNotesSidebar } from "@/components/exam";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useExamAnswers } from "@/features/exam/hooks/useExamAnswers";
import { useExamParts } from "@/features/exam/hooks/useExamParts";
import { ListeningSection } from "@/features/exam/sections/ListeningSection";
import { ReadingSection } from "@/features/exam/sections/ReadingSection";
import { SpeakingSection } from "@/features/exam/sections/SpeakingSection";
import { WritingSection } from "@/features/exam/sections/WritingSection";
import { AnswerValue } from "@/features/exam/types";
import { useAntiCheat, useExamSession } from "@/hooks";
import { api } from "@/lib/api";
import {
    getOriginalAssignmentIdFromPartId,
    isPartAssignmentId,
    isTaskAssignmentId,
    type PartNumber,
    type TaskNumber,
} from "@/lib/examParts";
import {
  getListeningPartQuestions,
  resolveListeningPartAudioUrl,
  resolveListeningPartDurationMinutes,
} from "@/lib/listeningAudio";
import { useExamNotesStore, useExamStore } from "@/store";
import {
    BreakStatus,
    ExamAssignment,
    ExamResult,
    ExamSection,
    Question,
    StartExamResponse,
} from "@/types";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AttemptHistoryItem {
  attempt: number;
  score: number | null;
  totalScore: number | null;
  bandScore: number | null;
  submittedAt: string;
}

interface PracticeSubmitMeta {
  resultId: string | null;
  submissionId: string | null;
  score: number | null;
  totalScore: number | null;
  bandScore: number | null;
  note: string | null;
}

interface PracticeAnswerRow {
  questionId: string;
  questionNumber: number;
  studentAnswer: string;
  correctAnswer: string;
  hasCorrectAnswer: boolean;
  isCorrect: boolean | null;
}

const normalizeAnswerValue = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
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

const formatAnswerValue = (value: unknown): string => {
  if (!hasAnswerValue(value)) {
    return "N/A";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${String(entry)}`)
      .join(", ");
  }

  return String(value);
};

const resolveQuestionCorrectAnswer = (question: Question): unknown => {
  if (!("correctAnswer" in question)) {
    return undefined;
  }

  const correctAnswer = (question as { correctAnswer?: unknown }).correctAnswer;
  if (
    (question.type === "MATCHING" ||
      question.type === "PLAN_MAP_LABELING" ||
      question.type === "DIAGRAM_LABELING") &&
    correctAnswer &&
    typeof correctAnswer === "object" &&
    !Array.isArray(correctAnswer)
  ) {
    return (correctAnswer as Record<string, unknown>)[question.id] ?? correctAnswer;
  }

  return correctAnswer;
};

const isAnswerCorrect = (
  studentAnswer: unknown,
  correctAnswer: unknown,
  questionType?: Question["type"],
): boolean => {
  if (!hasAnswerValue(studentAnswer) || !hasAnswerValue(correctAnswer)) {
    return false;
  }

  if (questionType === "MCQ_MULTIPLE" && Array.isArray(correctAnswer)) {
    const studentValues = Array.isArray(studentAnswer)
      ? studentAnswer
      : [studentAnswer];
    const studentSet = new Set(studentValues.map(normalizeAnswerValue));
    const correctSet = new Set(correctAnswer.map(normalizeAnswerValue));

    if (studentSet.size !== correctSet.size) {
      return false;
    }

    for (const value of studentSet) {
      if (!correctSet.has(value)) {
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
        (entry) => normalizeAnswerValue(studentAnswer[0]) === normalizeAnswerValue(entry),
      );
    }

    return correctAnswer.some(
      (entry) => normalizeAnswerValue(studentAnswer) === normalizeAnswerValue(entry),
    );
  }

  if (
    typeof studentAnswer === "object" &&
    studentAnswer !== null &&
    !Array.isArray(studentAnswer) &&
    typeof correctAnswer === "object" &&
    correctAnswer !== null &&
    !Array.isArray(correctAnswer)
  ) {
    return Object.entries(correctAnswer as Record<string, unknown>).every(
      ([key, expected]) =>
        normalizeAnswerValue((studentAnswer as Record<string, unknown>)[key]) ===
        normalizeAnswerValue(expected),
    );
  }

  return normalizeAnswerValue(studentAnswer) === normalizeAnswerValue(correctAnswer);
};

const resolveQuestionNumber = (question: Question, fallbackNumber: number): number => {
  if (typeof question.number === "number" && Number.isFinite(question.number)) {
    return question.number;
  }

  const idMatch = question.id.match(/\d+/);
  if (idMatch) {
    return Number(idMatch[0]);
  }

  return fallbackNumber;
};

const resolveWritingTaskNumber = (question: Question): number | null => {
  if (typeof question.number === "number" && Number.isFinite(question.number)) {
    const rounded = Math.floor(question.number);
    if (rounded >= 1) {
      return rounded;
    }
  }

  const normalizedId = question.id.trim().toLowerCase();
  const directMatch = normalizedId.match(/^(?:w|task)(\d+)$/);
  if (directMatch) {
    const parsed = Number.parseInt(directMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return null;
};

const resolveWritingTaskQuestion = (
  questions: Question[],
  taskNumber: number,
): Question | undefined => {
  const direct = questions.find(
    (question) => resolveWritingTaskNumber(question) === taskNumber,
  );
  if (direct) {
    return direct;
  }

  return questions[taskNumber - 1];
};

const resolveIndependentStudentAnswers = (value: unknown): string[] => {
  if (!hasAnswerValue(value)) {
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

const buildIndependentMcqRows = ({
  questionId,
  questionNumber,
  studentAnswerRaw,
  correctAnswerRaw,
}: {
  questionId: string;
  questionNumber: number;
  studentAnswerRaw: unknown;
  correctAnswerRaw: unknown[];
}): PracticeAnswerRow[] => {
  const studentAnswers = resolveIndependentStudentAnswers(studentAnswerRaw);
  const remainingCorrectAnswers = correctAnswerRaw
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  const consumeMatchingCorrectAnswer = (studentEntry: string): boolean => {
    const normalizedStudentEntry = normalizeAnswerValue(studentEntry);
    const matchedIndex = remainingCorrectAnswers.findIndex(
      (correctEntry) =>
        normalizeAnswerValue(correctEntry) === normalizedStudentEntry,
    );

    if (matchedIndex < 0) {
      return false;
    }

    remainingCorrectAnswers.splice(matchedIndex, 1);
    return true;
  };

  return correctAnswerRaw.map((_, offset) => {
    const studentEntry = studentAnswers[offset];

    if (!hasAnswerValue(studentEntry)) {
      const fallbackCorrectEntry = remainingCorrectAnswers.shift();
      return {
        questionId: `${questionId}::${offset + 1}`,
        questionNumber: questionNumber + offset,
        studentAnswer: "N/A",
        correctAnswer: formatAnswerValue(fallbackCorrectEntry),
        hasCorrectAnswer: true,
        isCorrect: false,
      };
    }

    if (consumeMatchingCorrectAnswer(studentEntry)) {
      return {
        questionId: `${questionId}::${offset + 1}`,
        questionNumber: questionNumber + offset,
        studentAnswer: formatAnswerValue(studentEntry),
        correctAnswer: formatAnswerValue(studentEntry),
        hasCorrectAnswer: true,
        isCorrect: true,
      };
    }

    const fallbackCorrectEntry = remainingCorrectAnswers.shift();
    return {
      questionId: `${questionId}::${offset + 1}`,
      questionNumber: questionNumber + offset,
      studentAnswer: formatAnswerValue(studentEntry),
      correctAnswer: formatAnswerValue(fallbackCorrectEntry),
      hasCorrectAnswer: true,
      isCorrect: false,
    };
  });
};

function ExamContent({ assignmentId }: { assignmentId: string }) {
  const { isLoading, isAuthenticated } = useAuth();
  const { timerEnabled } = useSettings();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceShowVideo = searchParams.get("showVideo") === "1";
  const isProctoredPractice = searchParams.get("proctored") === "1";
  const isOnlineMockFlow = searchParams.get("onlineMock") === "1";
  const onlineMockListeningId = searchParams.get("onlineMockListeningId") || "";
  const onlineMockReadingId = searchParams.get("onlineMockReadingId") || "";
  const onlineMockWritingId = searchParams.get("onlineMockWritingId") || "";

  const [assignment, setAssignment] = useState<
    (ExamAssignment & { remainingTime?: number }) | null
  >(null);
  const [currentQuestionId, setCurrentQuestionId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [showIntroVideo, setShowIntroVideo] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoAutoplayBlocked, setIsVideoAutoplayBlocked] = useState(false);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState<{ type: string; message: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(true); // Default to true to avoid flash on load until checked
  const [showExitWarningModal, setShowExitWarningModal] = useState(false);
  const [showPartResults, setShowPartResults] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{
    nextAssignmentId: string | null;
    breakEndsAt?: string | null;
    fullMockSessionId?: string | null;
  } | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistoryItem[]>([]);
  const [isAttemptHistoryLoading, setIsAttemptHistoryLoading] = useState(false);
  const [practiceSubmitMeta, setPracticeSubmitMeta] =
    useState<PracticeSubmitMeta | null>(null);
  const [practiceResultDetail, setPracticeResultDetail] =
    useState<ExamResult | null>(null);
  const [isPracticeResultLoading, setIsPracticeResultLoading] = useState(false);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(true);
  const noteCount = useExamNotesStore(
    (state) => state.notes.length + (state.composer && !state.composer.highlightId ? 1 : 0),
  );
  const openNotesSidebar = useExamNotesStore((state) => state.openSidebar);
  const resetNotesState = useExamNotesStore((state) => state.reset);
  const wasFullscreenRef = useRef<boolean>(true);
  const isExamCompletedRef = useRef<boolean>(false);
  const showExitWarningRef = useRef<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  useEffect(() => {
    resetNotesState();
  }, [assignmentId, resetNotesState]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // Detect if this is a partial assignment (part or task)
  const isPartialAssignment = useMemo(
    () => isPartAssignmentId(assignmentId) || isTaskAssignmentId(assignmentId),
    [assignmentId]
  );
  const originalAssignmentId = useMemo(
    () => (isPartialAssignment ? getOriginalAssignmentIdFromPartId(assignmentId) : assignmentId),
    [isPartialAssignment, assignmentId]
  );
  const assignmentPart = useMemo<PartNumber | null>(() => {
    if (!isPartialAssignment) return null;
    const match = assignmentId.match(/-part-(\d)$/);
    return match ? (parseInt(match[1], 10) as PartNumber) : null;
  }, [isPartialAssignment, assignmentId]);
  const assignmentTask = useMemo<TaskNumber | null>(() => {
    if (!isPartialAssignment) return null;
    const match = assignmentId.match(/-task-(\d)$/);
    return match ? (parseInt(match[1], 10) as TaskNumber) : null;
  }, [isPartialAssignment, assignmentId]);

  // Reusable helper: filter a full assignment down to the relevant part/task section.
  // Also caps remainingTime and endTime so the timer reflects the part's duration,
  // not the full section duration (e.g. 20 min for Reading part, not 60 min).
  const filterSectionForPart = useCallback(
    (data: ExamAssignment & { remainingTime?: number }): ExamAssignment & { remainingTime?: number } => {
      if (!isPartialAssignment || !data.section) return data;
      const section = data.section;
      const allQuestions = section.questions || [];

      // Helper: after filtering the section with a new partDuration,
      // cap remainingTime and endTime to the part's allowed window.
      const capTimingForPart = (
        filtered: ExamAssignment & { remainingTime?: number },
        partDurationMinutes: number
      ): ExamAssignment & { remainingTime?: number } => {
        const maxSeconds = partDurationMinutes * 60;
        const result = { ...filtered };

        // Cap remainingTime to the part's max duration
        if (typeof result.remainingTime === "number") {
          result.remainingTime = Math.min(result.remainingTime, maxSeconds);
        }

        // Recompute endTime from startTime + partDuration (if startTime exists)
        if (result.startTime) {
          const startMs = new Date(result.startTime).getTime();
          if (Number.isFinite(startMs)) {
            const partEndMs = startMs + maxSeconds * 1000;
            result.endTime = new Date(partEndMs).toISOString();
          }
        }

        return result;
      };

      if (section.type === "READING" && assignmentPart) {
        const passages = section.passages || [];
        if (passages.length >= assignmentPart) {
          const targetPassage = passages[assignmentPart - 1];
          const passageQuestions = allQuestions.filter(
            (q) => q.passageId === targetPassage.id
          );
          return capTimingForPart({
            ...data,
            section: {
              ...section,
              title: `${section.title} - Part ${assignmentPart}`,
              duration: 20,
              passages: [targetPassage],
              questions: passageQuestions,
            },
          }, 20);
        }
      } else if (section.type === "LISTENING" && assignmentPart) {
        const partQuestions = getListeningPartQuestions(allQuestions, assignmentPart);
        const partAudioUrl =
          resolveListeningPartAudioUrl(allQuestions, assignmentPart) ||
          section.audioUrl;
        const partDurationMinutes = resolveListeningPartDurationMinutes(
          allQuestions,
          assignmentPart,
          8,
        );
        return capTimingForPart({
          ...data,
          section: {
            ...section,
            title: `${section.title} - Section ${assignmentPart}`,
            duration: partDurationMinutes,
            questions: partQuestions,
            audioUrl: partAudioUrl,
          },
        }, partDurationMinutes);
      } else if (section.type === "WRITING" && assignmentTask) {
        const taskDuration = assignmentTask === 1 ? 20 : 40;
        const taskQuestion = resolveWritingTaskQuestion(allQuestions, assignmentTask);
        if (taskQuestion) {
          const numberedTaskQuestion = {
            ...taskQuestion,
            number: assignmentTask,
          };

          return capTimingForPart({
            ...data,
            section: {
              ...section,
              title: `${section.title} - Task ${assignmentTask}`,
              duration: taskDuration,
              questions: [numberedTaskQuestion],
            },
          }, taskDuration);
        }
      }
      return data;
    },
    [isPartialAssignment, assignmentPart, assignmentTask]
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const introContainerRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const isStartingRef = useRef(false);
  const antiCheatViolationCountRef = useRef(0);

  const isExamStarted = assignment?.status === "IN_PROGRESS";
  const requiresProctoring = Boolean(assignment?.fullMockSessionId);
  const isPracticeMode = !requiresProctoring;
  const isTimerActive = requiresProctoring || timerEnabled;
  // Fullscreen enforcement applies to offline (proctored) exams AND non-free practice tests
  const requiresFullscreen = requiresProctoring || isProctoredPractice;

  const resolvePracticeAttemptType = useCallback(() => {
    if (!isPartialAssignment) {
      return "Full";
    }

    if (assignmentPart) {
      return `Part ${assignmentPart}`;
    }

    if (assignmentTask) {
      return `Task ${assignmentTask}`;
    }

    return "Full";
  }, [isPartialAssignment, assignmentPart, assignmentTask]);

  const exitExamToDashboard = useCallback(async () => {
    isExamCompletedRef.current = true;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (exitErr) {
        console.warn("Failed to exit fullscreen:", exitErr);
      }
    }
    router.push("/dashboard");
  }, [router]);

  const exitExamToOnlineResults = useCallback(async () => {
    isExamCompletedRef.current = true;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (exitErr) {
        console.warn("Failed to exit fullscreen:", exitErr);
      }
    }
    router.push("/history");
  }, [router]);

  const onlineMockSequenceIds = useMemo(() => {
    return [onlineMockListeningId, onlineMockReadingId, onlineMockWritingId].filter(
      (id): id is string => id.trim().length > 0,
    );
  }, [onlineMockListeningId, onlineMockReadingId, onlineMockWritingId]);

  const createOnlineMockQuery = useCallback(
    (includeShowVideo = false) => {
      const params = new URLSearchParams();
      if (includeShowVideo) {
        params.set("showVideo", "1");
      }
      if (isOnlineMockFlow) {
        params.set("onlineMock", "1");
      }
      if (onlineMockListeningId) {
        params.set("onlineMockListeningId", onlineMockListeningId);
      }
      if (onlineMockReadingId) {
        params.set("onlineMockReadingId", onlineMockReadingId);
      }
      if (onlineMockWritingId) {
        params.set("onlineMockWritingId", onlineMockWritingId);
      }
      return params;
    },
    [
      isOnlineMockFlow,
      onlineMockListeningId,
      onlineMockReadingId,
      onlineMockWritingId,
    ],
  );

  const navigateToNextAssignment = useCallback(
    async (currentAssignmentId: string) => {
      const allAssignments = await api.getMyAssignments();
      
      // For partial exams, we only want to navigate to the same section type
      // unless we are in a full mock session (which we handle in handleFinalSubmit anyway)
      const allowedTypes = isPartialAssignment && assignment?.section?.type 
        ? [assignment.section.type] 
        : ["LISTENING", "READING", "WRITING", "SPEAKING"];

      const nextAssignment = allowedTypes
        .map((type) => allAssignments.find((a) => a.section?.type === type))
        .find((a) => a && a.status !== "SUBMITTED" && a.id !== currentAssignmentId);

      if (nextAssignment) {
        router.push(`/exam/${nextAssignment.id}?showVideo=1`);
        return;
      }

      await exitExamToDashboard();
    },
    [router, exitExamToDashboard, isPartialAssignment, assignment?.section?.type],
  );

  const redirectToBreak = useCallback(
    (assignmentIdToStart: string, breakEndsAt: string) => {
      const params = createOnlineMockQuery();
      params.set("next", assignmentIdToStart);
      params.set("endsAt", breakEndsAt);
      router.push(`/exam/break?${params.toString()}`);
    },
    [createOnlineMockQuery, router],
  );

  const handleContinuePart = useCallback(() => {
    setShowPartResults(false);
    setPendingNavigation(null);

    if (!pendingNavigation || !pendingNavigation.nextAssignmentId) {
      return;
    }

    // Check if we are jumping sections in partial mode
    if (isPartialAssignment && !pendingNavigation.fullMockSessionId) {
      const nextOriginalId =
        isPartAssignmentId(pendingNavigation.nextAssignmentId) ||
        isTaskAssignmentId(pendingNavigation.nextAssignmentId)
          ? getOriginalAssignmentIdFromPartId(pendingNavigation.nextAssignmentId)
          : pendingNavigation.nextAssignmentId;

      if (nextOriginalId !== originalAssignmentId) {
        exitExamToDashboard();
        return;
      }
    }

    if (pendingNavigation.breakEndsAt) {
      redirectToBreak(
        pendingNavigation.nextAssignmentId,
        pendingNavigation.breakEndsAt,
      );
      return;
    }

    const params = createOnlineMockQuery(true);
    router.push(`/exam/${pendingNavigation.nextAssignmentId}?${params.toString()}`);
  }, [pendingNavigation, redirectToBreak, router, exitExamToDashboard, isPartialAssignment, originalAssignmentId, createOnlineMockQuery]);



  const withComputedRemainingTime = useCallback(
    (nextAssignment: ExamAssignment & { remainingTime?: number }) => {
      if (typeof nextAssignment.remainingTime === "number") {
        return nextAssignment;
      }

      if (nextAssignment.status !== "IN_PROGRESS") {
        return nextAssignment;
      }

      let endTimestamp: number | null = null;

      if (nextAssignment.endTime) {
        const parsedEnd = new Date(nextAssignment.endTime).getTime();
        if (Number.isFinite(parsedEnd)) {
          endTimestamp = parsedEnd;
        }
      }

      if (
        endTimestamp === null &&
        nextAssignment.startTime &&
        typeof nextAssignment.section?.duration === "number"
      ) {
        const parsedStart = new Date(nextAssignment.startTime).getTime();
        if (Number.isFinite(parsedStart)) {
          endTimestamp = parsedStart + nextAssignment.section.duration * 60 * 1000;
        }
      }

      if (endTimestamp === null) {
        return nextAssignment;
      }

      return {
        ...nextAssignment,
        remainingTime: Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000)),
      };
    },
    [],
  );

  // Break circular dependency with useRef
  const handleFinalSubmitRef = useRef<() => void>(() => {});

  const handleSyncError = useCallback((err: Error) => {
    if (!requiresProctoring || showPartResults) {
      return;
    }
    console.error("Session sync error:", err);
    setSessionError({ type: "sync_error", message: err.message });
  }, [requiresProctoring, showPartResults]);

  const handleSessionExpired = useCallback(() => {
    if (!requiresProctoring || showPartResults || isSubmittingRef.current) {
      return;
    }

    setSessionError({
      type: "session_expired",
      message: "Your exam session has expired. Your answers have been submitted.",
    });
    handleFinalSubmitRef.current();
  }, [requiresProctoring, showPartResults]);

  const handleTabConflict = useCallback(() => {
    setSessionError({
      type: "tab_conflict",
      message: "This exam is open in another tab. Please close other tabs and refresh.",
    });
  }, []);

  const adaptiveHeartbeatIntervalMs =
    assignment?.section?.type === "LISTENING" ? 40000 : 30000;
  const adaptiveSyncDebounceMs =
    assignment?.section?.type === "LISTENING" ? 6500 : 5000;

  const { syncAnswers, tabId } = useExamSession({
    assignmentId: assignment?.id || null,
    enabled: isExamStarted && requiresProctoring && !showPartResults,
    heartbeatIntervalMs: adaptiveHeartbeatIntervalMs,
    syncDebounceMs: adaptiveSyncDebounceMs,
    onSyncError: handleSyncError,
    onSessionExpired: handleSessionExpired,
    onTabConflict: handleTabConflict,
  });

  const {
    answers,
    setAnswers,
    resetAnswers,
    updateAnswer,
  } = useExamAnswers({ syncAnswers });

  const handleAntiCheatViolation = useCallback(
    (violation: { type: string; detail: string; occurredAt: string }) => {
      antiCheatViolationCountRef.current += 1;
      updateAnswer(
        "_antiCheatViolationCount",
        String(antiCheatViolationCountRef.current),
      );
      updateAnswer("_lastAntiCheatViolation", JSON.stringify(violation));
    },
    [updateAnswer],
  );

  useAntiCheat(requiresProctoring, {
    onViolation: handleAntiCheatViolation,
  });



  const handleStartResponse = useCallback(
    (data: StartExamResponse) => {
      if ((data as BreakStatus).breakEndsAt) {
        const breakData = data as BreakStatus;
        redirectToBreak(breakData.assignmentId, breakData.breakEndsAt);
        return;
      }
      const filtered = filterSectionForPart(data as ExamAssignment & { remainingTime?: number });
      setAssignment(withComputedRemainingTime(filtered));
    },
    [redirectToBreak, withComputedRemainingTime, filterSectionForPart],
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (assignmentId && isAuthenticated) {
      setAssignment(null);
      resetAnswers();
      antiCheatViolationCountRef.current = 0;
      setError("");
      setAudioError(null);
      setIsAudioPlaying(false);
      setShowPlayOverlay(false);
      setShowPartResults(false);
      setPendingNavigation(null);
      setAttemptHistory([]);
      setPracticeSubmitMeta(null);
      setPracticeResultDetail(null);
      setIsPracticeResultLoading(false);
      setShowCorrectAnswers(true);

      api
        .getAssignment(originalAssignmentId)
        .then(async (data) => {
          // Filter section data for partial assignments (parts or tasks)
          const processedData = filterSectionForPart(data);
          
          const storedAnswers = useExamStore.getState().answers as Record<string, AnswerValue>;
          const sectionQuestions = (processedData.section?.questions || []) as Question[];
          const filteredLocalAnswers = sectionQuestions.length
            ? (Object.fromEntries(
                Object.entries(storedAnswers).filter(([id]) =>
                  sectionQuestions.some((question) => question.id === id)
                )
              ) as Record<string, AnswerValue>)
            : storedAnswers;
          const applyMergedAnswers = (serverAnswers?: Record<string, AnswerValue>) => {
            const merged = { ...(serverAnswers || {}), ...filteredLocalAnswers };
            setAnswers(merged);
          };
          const applyServerAnswers = (serverAnswers?: Record<string, AnswerValue>) => {
            setAnswers({ ...(serverAnswers || {}) });
          };
          const resetLocalSession = () => {
            useExamStore.getState().resetSession(originalAssignmentId);
          };

          // For self-study (online) exams, always restart on entry when status is
          // IN_PROGRESS or SUBMITTED. This intentionally drops prior progress so
          // students always begin from start after exiting.
          //
          // IMPORTANT: we must NOT setAssignment with stale IN_PROGRESS/SUBMITTED
          // data first; old endTime can cause immediate timer-expire loops.
          const isPractice = !data.fullMockSessionId;
          const shouldRestartPractice =
            isPractice &&
            (data.status === "IN_PROGRESS" || data.status === "SUBMITTED");

          if (shouldRestartPractice) {
            resetLocalSession();
            try {
              const startResponse = await api.startExam(originalAssignmentId);
              if ((startResponse as BreakStatus).breakEndsAt) {
                const breakData = startResponse as BreakStatus;
                redirectToBreak(breakData.assignmentId, breakData.breakEndsAt);
                return;
              }
              const restartedData = filterSectionForPart(startResponse as ExamAssignment & { remainingTime?: number });
              setAssignment(withComputedRemainingTime(restartedData));
              applyServerAnswers({});
              setShowIntroVideo(false);
              setShowPlayOverlay(
                restartedData.section?.type === "LISTENING" &&
                  restartedData.status !== "SUBMITTED"
              );
            } catch (startErr) {
              console.error("Failed to restart self-study exam:", startErr);
              setError("Failed to start exam. Please try again.");
            }
            return;
          }

          // Safe to set assignment for non-expired, non-SUBMITTED statuses
          setAssignment(withComputedRemainingTime(processedData));

          if (data.status === "IN_PROGRESS") {
            setShowIntroVideo(false);

            if (!processedData.fullMockSessionId) {
              applyMergedAnswers(processedData.answers as Record<string, AnswerValue>);

              if (processedData.section?.type === "LISTENING") {
                setShowPlayOverlay(true);
              }
              return;
            }

            // Restore from Redis session for active exams
            try {
              const tabId = typeof window !== "undefined" ? sessionStorage.getItem('exam_tab_id') : null;
              const reconnectData = await api.reconnectExam(
                originalAssignmentId,
                Object.keys(filteredLocalAnswers).length > 0
                  ? filteredLocalAnswers
                  : undefined,
                tabId || undefined
              );

              if (reconnectData.success && reconnectData.assignment) {
                // Filter reconnect data for partial assignments
                const processedReconnectData = filterSectionForPart(reconnectData.assignment as ExamAssignment & { remainingTime?: number });
                setAssignment(withComputedRemainingTime(processedReconnectData));
                applyMergedAnswers(processedReconnectData.answers as Record<string, AnswerValue>);
              } else {
                // If reconnect fails, fallback to DB data
                handleStartResponse(processedData as StartExamResponse);
                applyMergedAnswers(processedData.answers as Record<string, AnswerValue>);
              }
            } catch (err) {
              console.error("Reconnect failed during init:", err);
              handleStartResponse(processedData as StartExamResponse);
              applyMergedAnswers(processedData.answers as Record<string, AnswerValue>);
            }

            if (processedData.section?.type === "LISTENING") {
              setShowPlayOverlay(true);
            }
            return;
          }

          if (data.status === "ASSIGNED") {
            resetLocalSession();
          }

          // Intro videos are only for offline full-mock exams.
          // Online section/part/task assignments should always skip intro.
          const isPartialTest = isPartAssignmentId(assignmentId) || isTaskAssignmentId(assignmentId);
          const isOfflineExam = Boolean(processedData.fullMockSessionId);

          // Show intro video only when:
          // 1. The assignment belongs to an offline full-mock flow
          // 2. It's not a partial test, or it's the first part/task
          // 3. Exam is ASSIGNED or explicitly forced via query param
          const shouldShowIntro =
            isOfflineExam &&
            (!isPartialTest || assignmentPart === 1 || assignmentTask === 1) &&
            (data.status === "ASSIGNED" || forceShowVideo);
          
          if (shouldShowIntro) {
            applyServerAnswers(processedData.answers as Record<string, AnswerValue>);
            setShowIntroVideo(true);
            setShowPlayOverlay(false);
          } else {
            applyServerAnswers(processedData.answers as Record<string, AnswerValue>);
            setShowIntroVideo(false);
            setShowPlayOverlay(
              processedData.section?.type === "LISTENING" &&
                data.status !== "SUBMITTED"
            );
          }
        })
        .catch((err) => {
          setError(err.message);
        });
    }
  }, [assignmentId, originalAssignmentId, isPartialAssignment, assignmentPart, assignmentTask, forceShowVideo, handleStartResponse, isAuthenticated, withComputedRemainingTime, filterSectionForPart, redirectToBreak, resetAnswers, setAnswers]);

  const enterFullscreen = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userActivation = (navigator as any)?.userActivation;
      if (userActivation && !userActivation.isActive) {
        return;
      }

      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }

      // specific Logic to prevent Escape key from exiting fullscreen (Chrome/Edge only)
      // This requires the feature policy 'keyboard-map' and secure context
      // We re-apply this lock whenever we try to enter/re-enter fullscreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav?.keyboard?.lock) {
        try {
          await nav.keyboard.lock(["Escape"]);
          console.log("Keyboard lock acquired for Escape key");
        } catch (lockErr) {
          console.warn("Keyboard lock failed or not supported:", lockErr);
        }
      }
    } catch (err) {
      console.error("Error attempting to enable fullscreen:", err);
    }
  }, []);

  // Attempt fullscreen on first user interaction if not already fullscreen
  useEffect(() => {
    if (!requiresFullscreen) {
      return;
    }

    const handlePointerDown = () => {
      if (
        !document.fullscreenElement &&
        !isExamCompletedRef.current &&
        !showExitWarningRef.current &&
        (showIntroVideo || isExamStarted || assignment?.status === "ASSIGNED")
      ) {
        enterFullscreen();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [enterFullscreen, showIntroVideo, isExamStarted, assignment?.status, requiresFullscreen]);

  const handleStartExam = useCallback(async () => {
    if (sessionError) return;
    if (isStartingRef.current) return;
    if (requiresFullscreen && !document.fullscreenElement) {
      console.log("Blocking startExam - not in fullscreen");
      return;
    }
    isStartingRef.current = true;
    try {
      const data = await api.startExam(originalAssignmentId);
      handleStartResponse(data);
    } catch (err) {
      console.error("Failed to start exam:", err);
    } finally {
      isStartingRef.current = false;
    }
  }, [originalAssignmentId, handleStartResponse, sessionError, requiresFullscreen]);

  const handleVideoEnded = useCallback(() => {
    if (sessionError) return;
    setShowIntroVideo(false);

    if (assignment?.section?.type === "LISTENING") {
      setShowPlayOverlay(true);
    }
  }, [assignment?.section?.type, sessionError]);

  // Auto-start exam for all sections when ready (including listening after video ends)
  useEffect(() => {
    if (
      !showIntroVideo &&
      (requiresFullscreen ? isFullscreen : true) &&
      assignment?.status === "ASSIGNED" &&
      !sessionError &&
      !isLoading &&
      // For listening, only start if play overlay is not showing
      (assignment?.section?.type !== "LISTENING" || !showPlayOverlay)
    ) {
      handleStartExam();
    }
  }, [showIntroVideo, isFullscreen, assignment?.status, assignment?.section?.type, sessionError, isLoading, handleStartExam, showPlayOverlay, requiresFullscreen]);

  useEffect(() => {
    if (showIntroVideo && introVideoRef.current) {
      const video = introVideoRef.current;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          setIsVideoAutoplayBlocked(true);
        });
      }
    }
  }, [showIntroVideo]);

  // Fullscreen Enforcement Logic
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      const wasFs = wasFullscreenRef.current;
      wasFullscreenRef.current = isFs;
      setIsFullscreen(isFs);
      
      // Show warning if user exits fullscreen during active exam
      // Use ref for isExamCompleted to avoid stale closure when exitExamToDashboard
      // sets state and calls document.exitFullscreen() in the same tick
      if (
        requiresFullscreen &&
        wasFs &&
        !isFs &&
        isExamStarted &&
        !isExamCompletedRef.current &&
        !showIntroVideo
      ) {
        setShowExitWarningModal(true);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    
    // Initial check
    const initialFullscreen = !!document.fullscreenElement;
    wasFullscreenRef.current = initialFullscreen;
    setIsFullscreen(initialFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [isExamStarted, showIntroVideo, requiresFullscreen]);

  // If fullscreen is restored, ensure the warning modal closes
  useEffect(() => {
    if (isFullscreen && showExitWarningModal) {
      setShowExitWarningModal(false);
    }
  }, [isFullscreen, showExitWarningModal]);

  // Keep ref in sync so capture-phase handlers can read the latest value synchronously
  useEffect(() => {
    showExitWarningRef.current = showExitWarningModal;
  }, [showExitWarningModal]);

  // Block Escape key globally
  useEffect(() => {
    if (!requiresFullscreen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Optionally re-request lock if it was lost, though tricky without gesture
        console.log("Escape key blocked");
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true }); // Capture phase to intervene early
    window.addEventListener("keyup", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyDown, { capture: true });
    };
  }, [requiresFullscreen]);
  // Re-acquire lock on any user interaction to be safe, if we are in fullscreen
  useEffect(() => {
    if (!requiresFullscreen) {
      return;
    }

    const handleInteraction = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (document.fullscreenElement && !showExitWarningRef.current && nav?.keyboard?.lock) {
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         nav.keyboard.lock(["Escape"]).catch((e: any) => console.log("Silent lock update failed", e));
      }
    };

    window.addEventListener("click", handleInteraction);
    return () => window.removeEventListener("click", handleInteraction);
  }, [requiresFullscreen]);



  const handleAnswerChange = useCallback(
    (questionId: string, value: AnswerValue) => {
      updateAnswer(questionId, value);

      const isActualQuestionId =
        Array.isArray(assignment?.section?.questions) &&
        assignment.section.questions.some((question) => question.id === questionId);

      if (isActualQuestionId) {
        setCurrentQuestionId(questionId);
      }
    },
    [assignment?.section?.questions, updateAnswer]
  );

  const handleQuestionClick = useCallback(
    (questionId: string) => {
      setCurrentQuestionId(questionId);

      const element = document.getElementById(`question-${questionId}`);
      if (element) {
        if (assignment?.section?.type === "READING" && rightPanelRef.current) {
          const container = rightPanelRef.current;
          const containerTop = container.getBoundingClientRect().top;
          const elementTop = element.getBoundingClientRect().top;
          const scrollTarget = container.scrollTop + (elementTop - containerTop) - 20;

          container.scrollTo({
            top: scrollTarget,
            behavior: "smooth",
          });
        } else {
          const headerOffset = 80;
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: "smooth",
          });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
        if (rightPanelRef.current) {
          rightPanelRef.current.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    },
    [assignment?.section?.type]
  );





  const isTransientSubmitFailure = useCallback((err: unknown) => {
    if (!(err instanceof Error)) {
      return false;
    }

    return (
      err.message.includes("HTTP error! status: 502") ||
      err.message.includes("HTTP error! status: 503") ||
      err.message.includes("HTTP error! status: 504") ||
      err.message.includes("Request timeout after") ||
      err.message.includes("Failed to fetch")
    );
  }, []);

  const recoverSubmittedStateAfterFailure = useCallback(
    async (currentAssignmentId: string) => {
      try {
        const allAssignments = await api.getMyAssignments();
        const currentAssignment = allAssignments.find(
          (item) => item.id === currentAssignmentId,
        );

        if (currentAssignment?.status !== "SUBMITTED") {
          return false;
        }

        if (isPracticeMode) {
          await exitExamToDashboard();
          return true;
        }

        const hasPendingAssignment = allAssignments.some(
          (item) => item.status !== "SUBMITTED" && item.id !== currentAssignmentId,
        );

        if (hasPendingAssignment) {
          await navigateToNextAssignment(currentAssignmentId);
        } else {
          await exitExamToDashboard();
        }

        return true;
      } catch (verificationError) {
        console.error("Failed to verify submit status after transient error:", verificationError);
        return false;
      }
    },
    [navigateToNextAssignment, exitExamToDashboard, isPracticeMode],
  );

  const loadPracticeAttemptHistory = useCallback(async () => {
    if (requiresProctoring || !assignment?.section?.type) {
      return;
    }

    const sectionType = assignment.section.type;
    const startedAtMs = assignment.startTime
      ? new Date(assignment.startTime).getTime()
      : new Date(assignment.createdAt).getTime();
    const questionIds = new Set((assignment.section.questions || []).map((q) => q.id));

    setIsAttemptHistoryLoading(true);

    try {
      const results = await api.getMyResults();
      const relevantResults = results
        .filter((result) => {
          if (result.section?.type !== sectionType) {
            return false;
          }

          const submittedAtMs = new Date(result.submittedAt).getTime();
          if (Number.isFinite(startedAtMs) && submittedAtMs + 1000 < startedAtMs) {
            return false;
          }

          if (!isPartialAssignment) {
            return true;
          }

          const answerMap = (result.answers || {}) as Record<string, unknown>;
          const answerKeys = Object.keys(answerMap).filter(
            (key) => !key.startsWith("_"),
          );

          if (assignmentTask) {
            const taskKeys = assignmentTask === 1
              ? new Set(["w1", "task1"])
              : new Set(["w2", "task2"]);
            return (
              answerKeys.some((key) => taskKeys.has(key)) ||
              answerKeys.some((key) => questionIds.has(key))
            );
          }

          if (answerKeys.length === 0) {
            return false;
          }

          const matchingCount = answerKeys.filter((key) => questionIds.has(key)).length;
          return matchingCount > 0 && matchingCount === answerKeys.length;
        })
        .sort(
          (left, right) =>
            new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
        );

      const history: AttemptHistoryItem[] = relevantResults.map((result, index) => ({
        attempt: index + 1,
        score: typeof result.score === "number" ? Number(result.score) : null,
        totalScore:
          typeof result.totalScore === "number" ? Number(result.totalScore) : null,
        bandScore: typeof result.bandScore === "number" ? Number(result.bandScore) : null,
        submittedAt: result.submittedAt,
      }));

      setAttemptHistory(history);
    } catch (historyError) {
      console.warn("Failed to load practice attempt history:", historyError);
    } finally {
      setIsAttemptHistoryLoading(false);
    }
  }, [requiresProctoring, assignment, isPartialAssignment, assignmentTask]);

  const loadPracticeResultDetail = useCallback(async (resultId?: string | null) => {
    if (!resultId) {
      setPracticeResultDetail(null);
      setIsPracticeResultLoading(false);
      return;
    }

    setIsPracticeResultLoading(true);

    try {
      const result = await api.getResult(resultId);
      setPracticeResultDetail(result);
    } catch (resultError) {
      console.warn("Failed to load submitted result detail:", resultError);
      setPracticeResultDetail(null);
    } finally {
      setIsPracticeResultLoading(false);
    }
  }, []);

  const handleFinalSubmit = useCallback(async () => {
    if (!assignment || isSubmitting) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError("");

    let assignmentForSubmit: ExamAssignment & { remainingTime?: number } = assignment;

    if (assignmentForSubmit.status !== "IN_PROGRESS") {
      try {
        const startResponse = await api.startExam(originalAssignmentId);

        if ((startResponse as BreakStatus).status === "BREAK") {
          handleStartResponse(startResponse);
          setIsSubmitting(false);
          return;
        }

        const startedAssignment = withComputedRemainingTime(
          filterSectionForPart(startResponse as ExamAssignment & { remainingTime?: number }),
        );
        setAssignment(startedAssignment);
        assignmentForSubmit = startedAssignment;
      } catch (startError) {
        const startErrorMessage =
          startError instanceof Error
            ? startError.message
            : "Exam is not active. Please try again.";
        setError(startErrorMessage);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        return;
      }
    }

    try {
      await syncAnswers(answers);
    } catch (syncError) {
      console.error("Sync before submit failed:", syncError);
    }

    try {
      const attemptQuestions = Array.isArray(assignmentForSubmit.section?.questions)
        ? assignmentForSubmit.section.questions
        : [];
      const attemptQuestionCount = attemptQuestions.length;

      const submitAnswers: Record<string, unknown> = {
        ...answers,
        _attemptType: isPracticeMode ? resolvePracticeAttemptType() : "Full",
        _attemptMode:
          isPracticeMode || isOnlineMockFlow ? "standalone" : "full-mock",
        _attemptSource: isOnlineMockFlow
          ? "full-online-mock"
          : isPracticeMode
            ? "standalone"
            : "full-offline-mock",
        _assignmentId: assignmentForSubmit.id,
        _fullMockSessionId: isOnlineMockFlow
          ? null
          : assignmentForSubmit.fullMockSessionId ?? null,
        _attemptQuestionCount: attemptQuestionCount,
      };

      const submitTimeoutMs =
        assignmentForSubmit.section?.type === "SPEAKING" ? 180000 : 20000;

      const submitResult = await api.submitExam(
        assignmentForSubmit.id,
        submitAnswers,
        tabId,
        isPracticeMode,
        submitTimeoutMs,
      );

      const isOfflineMock = Boolean(submitResult.fullMockSessionId);

      if (isPracticeMode && !isOnlineMockFlow && !isOfflineMock && !submitResult.breakEndsAt) {
        const submitMeta: PracticeSubmitMeta = {
          resultId: submitResult.resultId ?? null,
          submissionId: submitResult.submissionId ?? null,
          score: typeof submitResult.score === "number" ? submitResult.score : null,
          totalScore:
            typeof submitResult.totalScore === "number"
              ? submitResult.totalScore
              : null,
          bandScore:
            typeof submitResult.bandScore === "number"
              ? submitResult.bandScore
              : null,
          note: submitResult.note || null,
        };

        setPendingNavigation({
          nextAssignmentId: null,
          breakEndsAt: submitResult.breakEndsAt,
          fullMockSessionId: submitResult.fullMockSessionId,
        });
        setPracticeSubmitMeta(submitMeta);
        setShowPartResults(true);
        setShowIntroVideo(false);
        setShowCorrectAnswers(true);
        void loadPracticeResultDetail(submitMeta.resultId);
        void loadPracticeAttemptHistory();
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        return;
      }

      if (submitResult.nextAssignmentId) {
        isExamCompletedRef.current = true;
        if (submitResult.breakEndsAt) {
          redirectToBreak(
            submitResult.nextAssignmentId,
            submitResult.breakEndsAt,
          );
          return;
        }
        const params = createOnlineMockQuery(true);
        router.push(`/exam/${submitResult.nextAssignmentId}?${params.toString()}`);
        return;
      }

      if (submitResult.fullMockSessionId) {
        isExamCompletedRef.current = true;
        if (isOnlineMockFlow) {
          await exitExamToOnlineResults();
        } else {
          await exitExamToDashboard();
        }
        return;
      }

      if (isOnlineMockFlow) {
        if (onlineMockSequenceIds.length === 0) {
          isExamCompletedRef.current = true;
          await exitExamToOnlineResults();
          return;
        }

        const currentIndex = onlineMockSequenceIds.findIndex(
          (id) => id === assignmentForSubmit.id,
        );

        if (currentIndex >= 0 && currentIndex + 1 < onlineMockSequenceIds.length) {
          const nextPackageAssignmentId = onlineMockSequenceIds[currentIndex + 1];
          const params = createOnlineMockQuery(true);
          router.push(`/exam/${nextPackageAssignmentId}?${params.toString()}`);
          return;
        }

        if (currentIndex === -1) {
          const fallbackNextId = onlineMockSequenceIds.find(
            (id) => id !== assignmentForSubmit.id,
          );
          if (fallbackNextId) {
            const params = createOnlineMockQuery(true);
            router.push(`/exam/${fallbackNextId}?${params.toString()}`);
            return;
          }
        }

        isExamCompletedRef.current = true;
        await exitExamToOnlineResults();
        return;
      }

      // If no next assignment, we are done.
      // Even here, maybe we want to show results before dashboard?
      // Requirement says: "ensuring that only the final part submission triggers a redirect to the feedback page"
      // So if this is the final part, we redirect (which navigateToNextAssignment or exitExamToDashboard will do).
      // So no change here for final part.

      isExamCompletedRef.current = true;
      await navigateToNextAssignment(assignmentForSubmit.id);
    } catch (err) {
      if (isTransientSubmitFailure(err)) {
        setError("Submit response not confirmed. Verifying latest exam state...");
        const recovered = await recoverSubmittedStateAfterFailure(
          assignmentForSubmit.id,
        );

        if (recovered) {
          return;
        }

        setError(
          "Temporary network issue while submitting. Please stay on this page and retry once connected.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Failed to submit exam");
      }

    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsReviewModalOpen(false);
      setIsConfirmModalOpen(false);
    }
  }, [assignment, isSubmitting, originalAssignmentId, handleStartResponse, withComputedRemainingTime, filterSectionForPart, syncAnswers, answers, tabId, isPracticeMode, resolvePracticeAttemptType, loadPracticeAttemptHistory, loadPracticeResultDetail, redirectToBreak, exitExamToDashboard, exitExamToOnlineResults, navigateToNextAssignment, isTransientSubmitFailure, recoverSubmittedStateAfterFailure, router, isOnlineMockFlow, onlineMockSequenceIds, createOnlineMockQuery]);

  // Keep ref updated
  useEffect(() => {
    handleFinalSubmitRef.current = handleFinalSubmit;
  }, [handleFinalSubmit]);

  const handleSubmit = useCallback(() => {
    if (!assignment) return;
    setIsReviewModalOpen(true);
  }, [assignment]);

  const handleWritingSubmit = useCallback(() => {
    if (!assignment) return;
    setIsConfirmModalOpen(true);
  }, [assignment]);

  const handleTimerExpire = useCallback(() => {
    if (!isTimerActive || showPartResults) {
      return;
    }
    handleFinalSubmit();
  }, [handleFinalSubmit, showPartResults, isTimerActive]);

  const handleSessionError = useCallback(() => {
    if (sessionError?.type === "tab_conflict") {
      window.location.reload();
    } else {
      setSessionError(null);
    }
  }, [sessionError]);

  const section = assignment?.section as ExamSection | undefined;

  const {
    parts,
    currentPartNumber,
    activePartIndex,
    currentPart,
    startQuestion,
    endQuestion,
  } = useExamParts({
    section,
    answers,
    currentQuestionId,
    forcedPartNumber:
      isPartialAssignment && (assignmentPart || assignmentTask)
        ? assignmentPart || assignmentTask
        : null,
  });

  const questions = useMemo(
    () => (section?.questions || []) as Question[],
    [section?.questions],
  );

  useEffect(() => {
    if (questions.length === 0) {
      if (currentQuestionId) {
        setCurrentQuestionId("");
      }
      return;
    }

    const currentExists = questions.some(
      (question) => question.id === currentQuestionId,
    );
    if (!currentExists) {
      setCurrentQuestionId(questions[0].id);
    }
  }, [questions, currentQuestionId]);

  const passages = useMemo(
    () =>
      (section?.passages || []) as {
        id: string;
        title: string;
        content: string;
      }[],
    [section?.passages],
  );

  const practiceQuestions = useMemo(() => {
    const resultQuestions = (practiceResultDetail?.section?.questions || []) as Question[];
    const baseQuestions = resultQuestions.length > 0 ? resultQuestions : questions;

    if (!isPartialAssignment || questions.length === 0) {
      return baseQuestions;
    }

    const visibleQuestionIds = new Set(questions.map((question) => question.id));
    return baseQuestions.filter((question) => visibleQuestionIds.has(question.id));
  }, [practiceResultDetail, questions, isPartialAssignment]);

  const practiceAnswerMap = useMemo<Record<string, unknown>>(
    () =>
      ((practiceResultDetail?.answers as Record<string, unknown> | undefined) ||
        (answers as Record<string, unknown>)),
    [practiceResultDetail, answers],
  );

  const practiceAnswerRows = useMemo<PracticeAnswerRow[]>(() => {
    return practiceQuestions.flatMap((question, index) => {
      const questionNumber = resolveQuestionNumber(question, index + 1);
      const studentAnswerRaw = practiceAnswerMap[question.id];
      const correctAnswerRaw = resolveQuestionCorrectAnswer(question);

      const shouldSplitIntoIndependentRows =
        question.type === "MCQ_MULTIPLE" &&
        Array.isArray(correctAnswerRaw) &&
        correctAnswerRaw.length > 1;

      if (shouldSplitIntoIndependentRows) {
        return buildIndependentMcqRows({
          questionId: question.id,
          questionNumber,
          studentAnswerRaw,
          correctAnswerRaw,
        });
      }

      const hasCorrectAnswer = hasAnswerValue(correctAnswerRaw);

      return {
        questionId: question.id,
        questionNumber,
        studentAnswer: formatAnswerValue(studentAnswerRaw),
        correctAnswer: formatAnswerValue(correctAnswerRaw),
        hasCorrectAnswer,
        isCorrect: hasCorrectAnswer
          ? isAnswerCorrect(studentAnswerRaw, correctAnswerRaw, question.type)
          : null,
      };
    });
  }, [practiceQuestions, practiceAnswerMap]);

  const objectiveRows = useMemo(
    () => practiceAnswerRows.filter((row) => row.hasCorrectAnswer),
    [practiceAnswerRows],
  );

  const practiceScoreText = useMemo(() => {
    if (objectiveRows.length > 0) {
      const correctCount = objectiveRows.filter((row) => row.isCorrect).length;
      return `${correctCount}/${objectiveRows.length}`;
    }

    if (
      practiceSubmitMeta &&
      typeof practiceSubmitMeta.score === "number" &&
      typeof practiceSubmitMeta.totalScore === "number"
    ) {
      return `${practiceSubmitMeta.score.toFixed(1)}/${practiceSubmitMeta.totalScore.toFixed(1)}`;
    }

    if (practiceSubmitMeta && typeof practiceSubmitMeta.bandScore === "number") {
      return `Band ${practiceSubmitMeta.bandScore.toFixed(1)}`;
    }

    return "Pending";
  }, [objectiveRows, practiceSubmitMeta]);

  const writingResponses = useMemo(() => {
    if (section?.type !== "WRITING") {
      return [];
    }

    const entries = [
      {
        label: "Task 1",
        value:
          (practiceAnswerMap["w1"] as string | undefined) ||
          (practiceAnswerMap["task1"] as string | undefined),
      },
      {
        label: "Task 2",
        value:
          (practiceAnswerMap["w2"] as string | undefined) ||
          (practiceAnswerMap["task2"] as string | undefined),
      },
    ];

    return entries.filter((entry) => hasAnswerValue(entry.value));
  }, [section?.type, practiceAnswerMap]);

  const speakingFeedback = useMemo(() => {
    if (section?.type !== "SPEAKING") {
      return null;
    }

    const feedback = (practiceResultDetail?.feedback || {}) as Record<string, unknown>;
    const rawParts = Array.isArray(feedback.parts)
      ? (feedback.parts as Array<Record<string, unknown>>)
      : [];

    const legacyEvaluation =
      feedback.evaluation && typeof feedback.evaluation === "object"
        ? (feedback.evaluation as Record<string, unknown>)
        : null;

    const normalizedParts =
      rawParts.length > 0
        ? rawParts
        : legacyEvaluation
          ? [
              {
                partNumber: 1,
                transcription: feedback.transcription,
                evaluation: legacyEvaluation,
              } as Record<string, unknown>,
            ]
          : [];

    const parts = normalizedParts.map((part, index) => {
      const evaluation = (part.evaluation || {}) as Record<string, unknown>;
      return {
        partNumber:
          typeof part.partNumber === "number" && Number.isFinite(part.partNumber)
            ? Math.max(1, Math.floor(part.partNumber))
            : index + 1,
        transcription: String(part.transcription || ""),
        strengths: Array.isArray(evaluation.strengths)
          ? (evaluation.strengths as unknown[]).map((item) => String(item))
          : [],
        weaknesses: Array.isArray(evaluation.weaknesses)
          ? (evaluation.weaknesses as unknown[]).map((item) => String(item))
          : [],
      };
    });

    return {
      parts,
    };
  }, [section?.type, practiceResultDetail?.feedback]);

  // ── Writing grading polling ──────────────────────────────────────
  // When the student submits a writing exam and lands on the inline results
  // screen, poll the backend for grading status every 3 seconds.  Once
  // grading completes, update the displayed score and auto-navigate to the
  // detailed review page.
  const [writingGradingLabel, setWritingGradingLabel] = useState<string>("Evaluating your writing...");

  useEffect(() => {
    if (!showPartResults) return;
    if (section?.type !== "WRITING") return;

    const subId = practiceSubmitMeta?.submissionId;
    const resultId = practiceSubmitMeta?.resultId;
    if (!subId) return;

    // If we already have a band score, no need to poll
    if (typeof practiceSubmitMeta?.bandScore === "number" && practiceSubmitMeta.bandScore > 0) {
      return;
    }

    let cancelled = false;
    let pollCount = 0;

    const poll = async () => {
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (cancelled) break;

        pollCount++;

        try {
          const status = await api.getWritingSubmissionStatus(subId);

          if (cancelled) break;

          if (status.isComplete) {
            // Update the score display immediately
            if (typeof status.bandScore === "number") {
              setPracticeSubmitMeta((prev) =>
                prev ? { ...prev, bandScore: status.bandScore ?? null } : prev,
              );
            }

            setWritingGradingLabel("Grading complete!");

            // Auto-navigate to the review page after a short delay
            if (resultId) {
              setTimeout(() => {
                if (!cancelled) {
                  router.push(`/history/review/${resultId}`);
                }
              }, 1500);
            }
            return;
          }

          if (status.isFailed) {
            setWritingGradingLabel(
              status.canRetry
                ? "Grading is being retried..."
                : "Grading failed. You can view your result later from History.",
            );
            if (!status.canRetry) return;
          }

          // Update progress label
          if (pollCount <= 3) {
            setWritingGradingLabel("Evaluating your writing...");
          } else if (pollCount <= 8) {
            setWritingGradingLabel("AI is still grading, please wait...");
          } else {
            setWritingGradingLabel("Taking longer than usual, hang tight...");
          }
        } catch {
          // Network error — keep trying silently
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [showPartResults, section?.type, practiceSubmitMeta?.submissionId, practiceSubmitMeta?.resultId, practiceSubmitMeta?.bandScore, router]);

  const handlePartClick = useCallback(
    (partNumber: number) => {
      const part = parts.find((current) => current.number === partNumber);
      if (part && part.questions.length > 0) {
        handleQuestionClick(part.questions[0].id);
      }
    },
    [parts, handleQuestionClick]
  );

  // Render loading or error state if assignment or section is not yet loaded
  if (isLoading || !assignment || !section) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-900"
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black mx-auto mb-4"></div>
            <p className="text-gray-400">Loading exam...</p>
          </div>
        )}
      </div>
    );
  }

  const timerStart =
    isTimerActive &&
    (requiresFullscreen ? isFullscreen : true) &&
    isExamStarted &&
    !showIntroVideo &&
    !showPartResults;

  if (showPartResults && isPracticeMode) {
    const hasNextStep = Boolean(pendingNavigation?.nextAssignmentId);
    const primaryButtonLabel = hasNextStep ? "Continue" : "Back to Dashboard";

    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-5xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <svg
                className="h-9 w-9 text-emerald-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900">Test Complete!</h2>
            <p className="mt-2 text-sm text-gray-500">Here are your results</p>
          </div>

          <div className="mx-auto mt-6 max-w-4xl rounded-2xl bg-gray-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-medium text-gray-700">Your Score</p>
              {section.type === "WRITING" && practiceScoreText === "Pending" ? (
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-red-500"></div>
                  <p className="text-lg font-semibold text-gray-500">{writingGradingLabel}</p>
                </div>
              ) : (
                <p className="text-4xl font-bold text-red-500">{practiceScoreText}</p>
              )}
            </div>
            {practiceSubmitMeta?.note && section.type !== "WRITING" && (
              <p className="mt-2 text-sm text-gray-600">{practiceSubmitMeta.note}</p>
            )}
            {section.type === "WRITING" && practiceScoreText === "Pending" && (
              <p className="mt-2 text-sm text-gray-500">
                Your essay is being evaluated by AI. Results will appear automatically.
              </p>
            )}
          </div>

          {isPracticeResultLoading ? (
            <div className="mx-auto mt-8 flex max-w-4xl items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 py-10">
              <div className="text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-black"></div>
                <p className="text-sm text-gray-500">Loading detailed answers...</p>
              </div>
            </div>
          ) : (
            <>
              {(section.type === "READING" || section.type === "LISTENING") && practiceAnswerRows.length > 0 && (
                <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-3xl font-semibold text-gray-900">Answer Sheet</h3>
                    {objectiveRows.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowCorrectAnswers((previousState) => !previousState)
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                      >
                        <span
                          className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
                            showCorrectAnswers ? "bg-red-500" : "bg-gray-300"
                          }`}
                        >
                          <span
                            className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                              showCorrectAnswers ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </span>
                        Show Correct Answers
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {practiceAnswerRows.map((row) => (
                      <article
                        key={row.questionId}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm font-bold text-white">
                            {row.questionNumber}
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="text-gray-700">
                              Your: <span className="font-medium text-gray-900">{row.studentAnswer}</span>
                              {row.hasCorrectAnswer && row.isCorrect === false && (
                                <span className="ml-2 font-semibold text-red-500">x</span>
                              )}
                              {row.hasCorrectAnswer && row.isCorrect === true && (
                                <span className="ml-2 font-semibold text-emerald-500">✓</span>
                              )}
                            </p>
                            {showCorrectAnswers && row.hasCorrectAnswer && (
                              <p className="mt-1 text-emerald-600">
                                Correct: <span className="font-medium">{row.correctAnswer}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {section.type === "WRITING" && writingResponses.length > 0 && (
                <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
                  <h3 className="text-xl font-semibold text-gray-900">Submitted Responses</h3>
                  <div className="mt-4 space-y-4">
                    {writingResponses.map((entry) => (
                      <article
                        key={entry.label}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <h4 className="text-sm font-bold uppercase tracking-wide text-gray-600">
                          {entry.label}
                        </h4>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                          {String(entry.value)}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {section.type === "SPEAKING" && speakingFeedback && (
                <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
                  <h3 className="text-xl font-semibold text-gray-900">Speaking Feedback</h3>
                  {speakingFeedback.parts.map((part) => (
                    <article
                      key={`speaking-feedback-part-${part.partNumber}`}
                      className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
                    >
                      <h4 className="text-sm font-bold uppercase tracking-wide text-gray-600">
                        Part {part.partNumber}
                      </h4>
                      {part.transcription && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                          {part.transcription}
                        </p>
                      )}
                      {part.strengths.length > 0 && (
                        <p className="mt-2 text-sm text-emerald-700">
                          Strengths: {part.strengths.join("; ")}
                        </p>
                      )}
                      {part.weaknesses.length > 0 && (
                        <p className="mt-2 text-sm text-amber-700">
                          Areas to improve: {part.weaknesses.join("; ")}
                        </p>
                      )}
                    </article>
                  ))}
                </section>
              )}
            </>
          )}

          <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Attempt History</h3>
              {isAttemptHistoryLoading && (
                <span className="text-xs text-gray-500">Updating...</span>
              )}
            </div>

            {attemptHistory.length === 0 ? (
              <p className="text-sm text-gray-500">
                Attempt history will appear after submissions.
              </p>
            ) : (
              <div className="space-y-2">
                {attemptHistory
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div
                      key={`${entry.attempt}-${entry.submittedAt}`}
                      className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-700">
                          Attempt {entry.attempt}
                        </span>
                        <span className="text-[11px] text-gray-500">
                          {new Date(entry.submittedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {typeof entry.score === "number"
                          ? `Score: ${entry.score.toFixed(1)}${typeof entry.totalScore === "number" ? ` / ${entry.totalScore.toFixed(1)}` : ""}`
                          : "Score pending"}
                      </p>
                      {typeof entry.bandScore === "number" && (
                        <p className="text-xs text-gray-600">Band: {entry.bandScore.toFixed(1)}</p>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </section>

          <div className="mx-auto mt-8 flex max-w-4xl justify-end">
            <button
              type="button"
              onClick={() => {
                if (hasNextStep) {
                  handleContinuePart();
                  return;
                }

                setShowPartResults(false);
                void exitExamToDashboard();
              }}
              className="inline-flex items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
            >
              {primaryButtonLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Fullscreen Exit Warning Modal */}
      {requiresFullscreen && (
        <>
          {/* Offline exam: non-dismissible, no exit option */}
          {requiresProctoring && (
            <ConfirmationModal
              isOpen={showExitWarningModal}
              onClose={() => setShowExitWarningModal(false)}
              onConfirm={() => {
                setShowExitWarningModal(false);
                enterFullscreen();
              }}
              title="Warning: Exit Fullscreen?"
              message="You are about to exit fullscreen mode. If you exit now, your exam progress may be lost and your results could be invalidated. Please stay in fullscreen to continue the exam safely."
              confirmText="Stay in Fullscreen"
              cancelText={null}
              variant="danger"
              dismissible={false}
            />
          )}
          {/* Non-free practice test: allow exit with session loss warning */}
          {isProctoredPractice && !requiresProctoring && (
            <ConfirmationModal
              isOpen={showExitWarningModal}
              onClose={() => {
                setShowExitWarningModal(false);
                exitExamToDashboard();
              }}
              onConfirm={() => {
                setShowExitWarningModal(false);
                enterFullscreen();
              }}
              title="Exit Test?"
              message="If you exit fullscreen, your current session will be lost and all progress will be discarded. Are you sure you want to leave?"
              confirmText="Stay in Fullscreen"
              cancelText="Exit Test"
              variant="danger"
              dismissible={false}
            />
          )}
        </>
      )}

      <div>
        {section.type === "READING" ? (
          <ReadingSection
            assignment={assignment}
            section={section}
            parts={parts}
            currentPartNumber={currentPartNumber}
            activePartIndex={activePartIndex}
            startQuestion={startQuestion}
            endQuestion={endQuestion}
            currentPart={currentPart}
            passages={passages}
            questions={questions}
            answers={answers}
            noteCount={noteCount}
            currentQuestionId={currentQuestionId}
            rightPanelRef={rightPanelRef}
            isSubmitting={isSubmitting}
            showIntroVideo={showIntroVideo}
            isSettingsOpen={isSettingsOpen}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseSettings={() => setIsSettingsOpen(false)}
            introVideoRef={introVideoRef}
            introContainerRef={introContainerRef}
            isVideoAutoplayBlocked={isVideoAutoplayBlocked}
            onVideoAutoplayBlockedChange={setIsVideoAutoplayBlocked}
            onVideoEnded={handleVideoEnded}
            onRequestFullscreen={enterFullscreen}
            onTimerExpire={handleTimerExpire}
            onAnswerChange={handleAnswerChange}
            onQuestionClick={handleQuestionClick}
            onQuestionFocus={setCurrentQuestionId}
            onPartClick={handlePartClick}
            onOpenNotes={openNotesSidebar}
            onSubmit={handleSubmit}
            onConfirmSubmit={handleFinalSubmit}
            isReviewModalOpen={isReviewModalOpen}
            isConfirmModalOpen={isConfirmModalOpen}
            onReviewClose={() => setIsReviewModalOpen(false)}
            onReviewConfirm={() => setIsConfirmModalOpen(true)}
            onConfirmClose={() => setIsConfirmModalOpen(false)}
            sessionError={sessionError}
            onSessionResolve={handleSessionError}
            timerStart={timerStart}
            showTimer={isTimerActive}
            showPartResults={showPartResults}
            onContinue={handleContinuePart}
          />
        ) : section.type === "WRITING" ? (
          <WritingSection
            assignment={assignment}
            section={section}
            parts={parts}
            currentPartNumber={currentPartNumber}
            activePartIndex={activePartIndex}
            currentQuestionId={currentQuestionId}
            answers={answers}
            noteCount={noteCount}
            showIntroVideo={showIntroVideo}
            isSettingsOpen={isSettingsOpen}
            isVideoAutoplayBlocked={isVideoAutoplayBlocked}
            introVideoRef={introVideoRef}
            introContainerRef={introContainerRef}
            onVideoAutoplayBlockedChange={setIsVideoAutoplayBlocked}
            onVideoEnded={handleVideoEnded}
            onRequestFullscreen={enterFullscreen}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseSettings={() => setIsSettingsOpen(false)}
            onTimerExpire={handleTimerExpire}
            onAnswerChange={handleAnswerChange}
            onQuestionFocus={setCurrentQuestionId}
            onQuestionClick={handleQuestionClick}
            onPartClick={handlePartClick}
            onOpenNotes={openNotesSidebar}
            onSubmit={handleWritingSubmit}
            isSubmitting={isSubmitting}
            sessionError={sessionError}
            onSessionResolve={() => setSessionError(null)}
            timerStart={timerStart}
            showTimer={isTimerActive}
            showPartResults={showPartResults}
            onContinue={handleContinuePart}
          />
        ) : section.type === "SPEAKING" ? (
          <SpeakingSection
            assignment={assignment}
            section={section}
            parts={parts}
            activePartIndex={activePartIndex}
            currentQuestionId={currentQuestionId}
            answers={answers}
            showIntroVideo={showIntroVideo}
            isSettingsOpen={isSettingsOpen}
            isVideoAutoplayBlocked={isVideoAutoplayBlocked}
            introVideoRef={introVideoRef}
            introContainerRef={introContainerRef}
            onVideoAutoplayBlockedChange={setIsVideoAutoplayBlocked}
            onVideoEnded={handleVideoEnded}
            onRequestFullscreen={enterFullscreen}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseSettings={() => setIsSettingsOpen(false)}
            onTimerExpire={handleTimerExpire}
            onAnswerChange={handleAnswerChange}
            onQuestionClick={handleQuestionClick}
            onPartClick={handlePartClick}
            onSubmit={handleFinalSubmit}
            isSubmitting={isSubmitting}
            submitError={error}
            sessionError={sessionError}
            onSessionResolve={() => setSessionError(null)}
            timerStart={timerStart}
            showTimer={isTimerActive}
            showPartResults={showPartResults}
            onContinue={handleContinuePart}
          />
        ) : (
          <ListeningSection
            assignment={assignment}
            section={section}
            parts={parts}
            currentPartNumber={currentPartNumber}
            activePartIndex={activePartIndex}
            startQuestion={startQuestion}
            endQuestion={endQuestion}
            currentPart={currentPart}
            questions={questions}
            answers={answers}
            noteCount={noteCount}
            currentQuestionId={currentQuestionId}
            isSubmitting={isSubmitting}
            showIntroVideo={showIntroVideo}
            showPlayOverlay={showPlayOverlay}
            isSettingsOpen={isSettingsOpen}
            isAudioPlaying={isAudioPlaying}
            audioError={audioError}
            audioRef={audioRef}
            introVideoRef={introVideoRef}
            introContainerRef={introContainerRef}
            isVideoAutoplayBlocked={isVideoAutoplayBlocked}
            onVideoAutoplayBlockedChange={setIsVideoAutoplayBlocked}
            onVideoEnded={handleVideoEnded}
            onRequestFullscreen={enterFullscreen}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseSettings={() => setIsSettingsOpen(false)}
            onAudioPlay={() => setIsAudioPlaying(true)}
            onAudioPause={() => setIsAudioPlaying(false)}
            onAudioError={setAudioError}
            onPlayOverlayClose={() => setShowPlayOverlay(false)}
            onStartExam={handleStartExam}
            onTimerExpire={handleTimerExpire}
            onAnswerChange={handleAnswerChange}
            onQuestionClick={handleQuestionClick}
            onQuestionFocus={setCurrentQuestionId}
            onPartClick={handlePartClick}
            onOpenNotes={openNotesSidebar}
            onSubmit={handleSubmit}
            onConfirmSubmit={handleFinalSubmit}
            isReviewModalOpen={isReviewModalOpen}
            isConfirmModalOpen={isConfirmModalOpen}
            onReviewClose={() => setIsReviewModalOpen(false)}
            onReviewConfirm={() => setIsConfirmModalOpen(true)}
            onConfirmClose={() => setIsConfirmModalOpen(false)}
            sessionError={sessionError}
            onSessionResolve={handleSessionError}
            timerStart={timerStart}
            showTimer={isTimerActive}
            showPartResults={showPartResults}
            onContinue={handleContinuePart}
          />
        )}
      </div>

      {section.type === "WRITING" && (
        <ConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={handleFinalSubmit}
          title="Finish Section?"
          message="Are you sure you want to finish this section? You will not be able to change your answers after this."
          confirmText="Finish"
          cancelText="Go Back"
          variant="danger"
          isLoading={isSubmitting}
        />
      )}

      <ExamNotesSidebar />
    </>
  );
}

export default function ExamPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  if (!assignmentId) return null;

  return <ExamContent key={assignmentId} assignmentId={assignmentId} />;
}
