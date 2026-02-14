"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useExamParts } from "@/features/exam/hooks/useExamParts";
import { ListeningSection } from "@/features/exam/sections/ListeningSection";
import { ReadingSection } from "@/features/exam/sections/ReadingSection";
import { WritingSection } from "@/features/exam/sections/WritingSection";
import { AnswerValue } from "@/features/exam/types";
import { useAntiCheat, useExamSession } from "@/hooks";
import { api } from "@/lib/api";
import { useExamStore } from "@/store";
import { BreakStatus, ExamAssignment, ExamSection, Question, StartExamResponse } from "@/types";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

function ExamContent({ assignmentId }: { assignmentId: string }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceShowVideo = searchParams.get("showVideo") === "1";

  const [assignment, setAssignment] = useState<
    (ExamAssignment & { remainingTime?: number }) | null
  >(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
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
  const [isExamCompleted, setIsExamCompleted] = useState(false);
  const wasFullscreenRef = useRef<boolean>(true);


  const audioRef = useRef<HTMLAudioElement>(null) as unknown as RefObject<HTMLAudioElement>;
  const introVideoRef = useRef<HTMLVideoElement>(null) as unknown as RefObject<HTMLVideoElement>;
  const introContainerRef = useRef<HTMLDivElement>(null) as unknown as RefObject<HTMLDivElement>;
  const rightPanelRef = useRef<HTMLDivElement>(null) as unknown as RefObject<HTMLDivElement>;
  const syncDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const isExamStarted = assignment?.status === "IN_PROGRESS";

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
    console.error("Session sync error:", err);
    setSessionError({ type: "sync_error", message: err.message });
  }, []);

  const handleSessionExpired = useCallback(() => {
    setSessionError({
      type: "session_expired",
      message: "Your exam session has expired. Your answers have been submitted.",
    });
    handleFinalSubmitRef.current();
  }, []);

  const handleTabConflict = useCallback(() => {
    setSessionError({
      type: "tab_conflict",
      message: "This exam is open in another tab. Please close other tabs and refresh.",
    });
  }, []);

  const { syncAnswers, tabId } = useExamSession({
    assignmentId: assignment?.id || null,
    enabled: isExamStarted,
    onSyncError: handleSyncError,
    onSessionExpired: handleSessionExpired,
    onTabConflict: handleTabConflict,
  });

  useAntiCheat();

  const redirectToBreak = useCallback(
    (assignmentIdToStart: string, breakEndsAt: string) => {
      const params = new URLSearchParams({
        next: assignmentIdToStart,
        endsAt: breakEndsAt,
      });
      router.push(`/exam/break?${params.toString()}`);
    },
    [router],
  );

  const handleStartResponse = useCallback(
    (data: StartExamResponse) => {
      if ((data as BreakStatus).breakEndsAt) {
        const breakData = data as BreakStatus;
        redirectToBreak(breakData.assignmentId, breakData.breakEndsAt);
        return;
      }
      setAssignment(withComputedRemainingTime(data as ExamAssignment & { remainingTime?: number }));
    },
    [redirectToBreak, withComputedRemainingTime],
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (assignmentId && isAuthenticated) {
      setAssignment(null);
      setAnswers({});
      setError("");

      api
        .getAssignment(assignmentId)
        .then(async (data) => {
          setAssignment(withComputedRemainingTime(data));
          
          const storedAnswers = useExamStore.getState().answers as Record<string, AnswerValue>;
          const sectionQuestions = (data.section?.questions || []) as Question[];
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
            useExamStore.getState().resetSession(assignmentId);
          };

          if (data.status === "IN_PROGRESS") {
            setShowIntroVideo(false);
            // Restore from Redis session for active exams
            try {
              const tabId = typeof window !== "undefined" ? sessionStorage.getItem('exam_tab_id') : null;
              const reconnectData = await api.reconnectExam(
                assignmentId, 
                Object.keys(filteredLocalAnswers).length > 0
                  ? (filteredLocalAnswers as Record<string, any>)
                  : undefined,
                tabId || undefined
              );
              
              if (reconnectData.success && reconnectData.assignment) {
                setAssignment(withComputedRemainingTime(reconnectData.assignment));
                applyMergedAnswers(reconnectData.assignment.answers as Record<string, AnswerValue>);
              } else {
                // If reconnect fails, fallback to DB data
                handleStartResponse(data as StartExamResponse);
                applyMergedAnswers(data.answers as Record<string, AnswerValue>);
              }
            } catch (err) {
              console.error("Reconnect failed during init:", err);
              handleStartResponse(data as StartExamResponse);
              applyMergedAnswers(data.answers as Record<string, AnswerValue>);
            }

            if (data.section?.type === "LISTENING") {
              // Only show play overlay if audio hasn't started (approximated by lack of answers or explicit state)
              // For now, simpler to always show it on refresh for Listening
              setShowPlayOverlay(true);
            }
            return;
          }

          if (data.status === "ASSIGNED") {
            resetLocalSession();
          }

          if (data.status === "ASSIGNED" || forceShowVideo) {
            applyServerAnswers(data.answers as Record<string, AnswerValue>);
            setShowIntroVideo(true);
          } else {
            applyServerAnswers(data.answers as Record<string, AnswerValue>);
          }
        })
        .catch((err) => {
          setError(err.message);
        });
    }
  }, [assignmentId, forceShowVideo, handleStartResponse, isAuthenticated, withComputedRemainingTime]);

  const enterFullscreen = useCallback(async () => {
    try {
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
    const handlePointerDown = () => {
      if (!document.fullscreenElement && (showIntroVideo || isExamStarted || assignment?.status === "ASSIGNED")) {
        enterFullscreen();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [enterFullscreen, showIntroVideo, isExamStarted, assignment?.status]);

  const handleStartExam = useCallback(async () => {
    if (sessionError) return;
    if (!document.fullscreenElement) {
      console.log("Blocking startExam - not in fullscreen");
      return;
    }
    try {
      const data = await api.startExam(assignmentId);
      handleStartResponse(data);
    } catch (err) {
      console.error("Failed to start exam:", err);
    }
  }, [assignmentId, handleStartResponse, sessionError]);

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
      isFullscreen &&
      assignment?.status === "ASSIGNED" &&
      !sessionError &&
      !isLoading &&
      // For listening, only start if play overlay is not showing
      (assignment?.section?.type !== "LISTENING" || !showPlayOverlay)
    ) {
      handleStartExam();
    }
  }, [showIntroVideo, isFullscreen, assignment?.status, assignment?.section?.type, sessionError, isLoading, handleStartExam, showPlayOverlay]);

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
      if (wasFs && !isFs && isExamStarted && !isExamCompleted && !showIntroVideo) {
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
  }, [isExamStarted, isExamCompleted, showIntroVideo]);

  // If fullscreen is restored, ensure the warning modal closes
  useEffect(() => {
    if (isFullscreen && showExitWarningModal) {
      setShowExitWarningModal(false);
    }
  }, [isFullscreen, showExitWarningModal]);

  // Block Escape key globally
  useEffect(() => {
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
  }, []);
  // Re-acquire lock on any user interaction to be safe, if we are in fullscreen
  useEffect(() => {
    const handleInteraction = () => {
      const nav = navigator as any;
      if (document.fullscreenElement && nav?.keyboard?.lock) {
         nav.keyboard.lock(["Escape"]).catch((e: any) => console.log("Silent lock update failed", e));
      }
    };

    window.addEventListener("click", handleInteraction);
    return () => window.removeEventListener("click", handleInteraction);
  }, []);



  const handleAnswerChange = useCallback(
    (questionId: string, value: AnswerValue) => {
      // Sync with Zustand store for persistent local backup
      useExamStore.getState().setAnswer(questionId, value as any);

      setAnswers((prev) => {
        const newAnswers = { ...prev, [questionId]: value };

        if (syncDebounceRef.current) {
          clearTimeout(syncDebounceRef.current);
        }

        syncDebounceRef.current = setTimeout(() => {
          syncAnswers(newAnswers);
        }, 2000);

        return newAnswers;
      });
      setCurrentQuestionId(questionId);
    },
    [syncAnswers]
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

  const exitExamToDashboard = useCallback(async () => {
    setIsExamCompleted(true);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (exitErr) {
        console.warn("Failed to exit fullscreen:", exitErr);
      }
    }
    router.push("/dashboard");
  }, [router]);

  const navigateToNextAssignment = useCallback(
    async (currentAssignmentId: string) => {
      const allAssignments = await api.getMyAssignments();
      const nextAssignment = ["LISTENING", "READING", "WRITING"]
        .map((type) => allAssignments.find((a) => a.section?.type === type))
        .find((a) => a && a.status !== "SUBMITTED" && a.id !== currentAssignmentId);

      if (nextAssignment) {
        router.push(`/exam/${nextAssignment.id}?showVideo=1`);
        return;
      }

      await exitExamToDashboard();
    },
    [router, exitExamToDashboard],
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
    [navigateToNextAssignment, exitExamToDashboard],
  );

  const handleFinalSubmit = useCallback(async () => {
    if (!assignment || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await syncAnswers(answers);
    } catch (syncError) {
      console.error("Sync before submit failed:", syncError);
    }

    try {
      const submitResult = await api.submitExam(assignment.id, answers, tabId);

      if (submitResult.nextAssignmentId) {
        if (submitResult.breakEndsAt) {
          redirectToBreak(
            submitResult.nextAssignmentId,
            submitResult.breakEndsAt,
          );
          return;
        }
        router.push(`/exam/${submitResult.nextAssignmentId}?showVideo=1`);
        return;
      }

      if (submitResult.fullMockSessionId) {
        await exitExamToDashboard();
        return;
      }

      await navigateToNextAssignment(assignment.id);
    } catch (err) {
      if (isTransientSubmitFailure(err)) {
        setError("Submit response not confirmed. Verifying latest exam state...");
        const recovered = await recoverSubmittedStateAfterFailure(assignment.id);

        if (recovered) {
          return;
        }

        setError(
          "Temporary network issue while submitting. Please stay on this page and retry once connected.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Failed to submit exam");
      }

      setIsSubmitting(false);
    } finally {
      setIsReviewModalOpen(false);
      setIsConfirmModalOpen(false);
    }
  }, [assignment, isSubmitting, syncAnswers, answers, redirectToBreak, exitExamToDashboard, navigateToNextAssignment, isTransientSubmitFailure, recoverSubmittedStateAfterFailure]);

  // Keep ref updated
  useEffect(() => {
    handleFinalSubmitRef.current = handleFinalSubmit;
  }, [handleFinalSubmit]);

  const handleSubmit = useCallback(() => {
    if (!assignment) return;
    setIsReviewModalOpen(true);
  }, [assignment]);

  const handleTimerExpire = useCallback(() => {
    handleFinalSubmit();
  }, [handleFinalSubmit]);

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
  });

  const questions = (section?.questions || []) as Question[];
  const passages = (section?.passages || []) as { id: string; title: string; content: string }[];

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

  const timerStart = isFullscreen && isExamStarted && !showIntroVideo;

  return (
    <>
      {/* Fullscreen Exit Warning Modal */}
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
          />
        ) : section.type === "WRITING" ? (
          <WritingSection
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
            onQuestionFocus={setCurrentQuestionId}
            onQuestionClick={handleQuestionClick}
            onPartClick={handlePartClick}
            onSubmit={handleFinalSubmit}
            isSubmitting={isSubmitting}
            sessionError={sessionError}
            onSessionResolve={() => setSessionError(null)}
            timerStart={timerStart}
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
          />
        )}
      </div>
    </>
  );
}

export default function ExamPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  if (!assignmentId) return null;

  return <ExamContent key={assignmentId} assignmentId={assignmentId} />;
}
