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


  const audioRef = useRef<HTMLAudioElement>(null) as unknown as RefObject<HTMLAudioElement>;
  const introVideoRef = useRef<HTMLVideoElement>(null) as unknown as RefObject<HTMLVideoElement>;
  const introContainerRef = useRef<HTMLDivElement>(null) as unknown as RefObject<HTMLDivElement>;
  const rightPanelRef = useRef<HTMLDivElement>(null) as unknown as RefObject<HTMLDivElement>;
  const syncDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const isExamStarted = assignment?.status === "IN_PROGRESS";

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

  const { isSyncing, syncAnswers } = useExamSession({
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
      setAssignment(data as ExamAssignment & { remainingTime?: number });
    },
    [redirectToBreak],
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
          setAssignment(data);
          
          if (data.status === "ASSIGNED" || forceShowVideo) {
            if (data.answers) {
              setAnswers(data.answers as Record<string, AnswerValue>);
            }
            setShowIntroVideo(true);
          } else if (data.status === "IN_PROGRESS") {
            // Restore from Redis session for active exams
            try {
              const tabId = typeof window !== "undefined" ? sessionStorage.getItem('exam_tab_id') : null;
              // Get latest local answers from persistent store to ensure we don't lose unsynced changes
              const { useExamStore } = await import("@/store");
              const localAnswers = useExamStore.getState().answers;
              
              const reconnectData = await api.reconnectExam(
                assignmentId, 
                (localAnswers && Object.keys(localAnswers).length > 0) ? (localAnswers as Record<string, any>) : undefined, 
                tabId || undefined
              );
              
              if (reconnectData.success && reconnectData.assignment) {
                setAssignment(reconnectData.assignment);
                if (reconnectData.assignment.answers) {
                  setAnswers(reconnectData.assignment.answers as Record<string, AnswerValue>);
                }
              } else {
                // If reconnect fails, fallback to DB data
                handleStartResponse(data as StartExamResponse);
                if (data.answers) {
                  setAnswers(data.answers as Record<string, AnswerValue>);
                }
              }
            } catch (err) {
              console.error("Reconnect failed during init:", err);
              handleStartResponse(data as StartExamResponse);
            }

            if (data.section?.type === "LISTENING") {
              // Only show play overlay if audio hasn't started (approximated by lack of answers or explicit state)
              // For now, simpler to always show it on refresh for Listening
              setShowPlayOverlay(true);
            }
          }
        })
        .catch((err) => {
          setError(err.message);
        });
    }
  }, [assignmentId, forceShowVideo, handleStartResponse, isAuthenticated]);

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

  // Auto-start exam for non-listening sections when ready
  useEffect(() => {
    if (
      !showIntroVideo &&
      isFullscreen &&
      assignment?.status === "ASSIGNED" &&
      assignment?.section?.type !== "LISTENING" &&
      !sessionError &&
      !isLoading
    ) {
      handleStartExam();
    }
  }, [showIntroVideo, isFullscreen, assignment?.status, assignment?.section?.type, sessionError, isLoading, handleStartExam]);

  useEffect(() => {
    if (showIntroVideo && introVideoRef.current) {
      const video = introVideoRef.current;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          setIsVideoAutoplayBlocked(true);
        });
      }

      // Try to enter fullscreen automatically on video start if possible (usually blocked without user gesture)
      // We'll rely on the enforcement overlay mostly
      const container = introContainerRef.current;
      if (container && container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          // Expected behavior if no user interaction
        });
      }
    }
  }, [showIntroVideo]);

  // Fullscreen Enforcement Logic
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    
    // Initial check
    setIsFullscreen(!!document.fullscreenElement);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

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


  const enterFullscreen = useCallback(async () => {
    try {
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

  const handleFinalSubmit = useCallback(async () => {
    if (!assignment || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await syncAnswers(answers);
    } catch (syncError) {
      console.error("Sync before submit failed:", syncError);
    }

    try {
      const submitResult = await api.submitExam(assignment.id, answers);

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
        router.push("/dashboard");
        return;
      }

      const allAssignments = await api.getMyAssignments();
      const nextAssignment = ["LISTENING", "READING", "WRITING"]
        .map((type) => allAssignments.find((a) => a.section?.type === type))
        .find((a) => a && a.status !== "SUBMITTED" && a.id !== assignment.id);

      if (nextAssignment) {
        router.push(`/exam/${nextAssignment.id}?showVideo=1`);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit exam");
      setIsSubmitting(false);
    } finally {
      setIsReviewModalOpen(false);
      setIsConfirmModalOpen(false);
    }
  }, [assignment, answers, redirectToBreak, router, syncAnswers]);

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

  const showFullscreenOverlay = assignment && (isExamStarted || assignment.status === "ASSIGNED") && !isFullscreen && !showIntroVideo;
  const timerStart = isFullscreen && isExamStarted && !showIntroVideo;

  return (
    <>
      {showFullscreenOverlay && (
        <div
          className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-4 notranslate"
          translate="no"
        >
          <div className="max-w-md text-center">
            <div className="mb-6 mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Fullscreen Required</h2>
            <p className="text-gray-600 mb-8">
              Please enable fullscreen mode to continue with your exam.
            </p>
            <button
              onClick={enterFullscreen}
              className="w-full bg-black text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-900 transition-colors"
            >
              Enter Fullscreen
            </button>
          </div>
        </div>
      )}
      
      <div className={showFullscreenOverlay ? "hidden" : "block"}>
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
            isSyncing={isSyncing}
            showIntroVideo={showIntroVideo}
            isSettingsOpen={isSettingsOpen}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseSettings={() => setIsSettingsOpen(false)}
            introVideoRef={introVideoRef}
            introContainerRef={introContainerRef}
            isVideoAutoplayBlocked={isVideoAutoplayBlocked}
            onVideoAutoplayBlockedChange={setIsVideoAutoplayBlocked}
            onVideoEnded={handleVideoEnded}
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
            isSyncing={isSyncing}
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
