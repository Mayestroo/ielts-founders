'use client';

import { BottomNav, ExamHeader, PartBanner, SettingsModal } from '@/components/exam';
import { ExamAssignment, ExamSection, Question } from '@/types';
import { RefObject, useEffect, useMemo, useState } from 'react';
import { IntroVideoOverlay } from '../components/IntroVideoOverlay';
import { QuestionGroups } from '../components/QuestionGroups';
import { ReviewAndConfirmModals } from '../components/ReviewAndConfirmModals';
import { SessionIssueModal } from '../components/SessionIssueModal';
import { AnswerValue, ExamPart } from '../types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') ||
  'http://localhost:3000';

interface ListeningSectionProps {
  assignment: ExamAssignment & { remainingTime?: number };
  section: ExamSection;
  parts: ExamPart[];
  currentPartNumber: number;
  activePartIndex: number;
  startQuestion: number;
  endQuestion: number;
  currentPart?: ExamPart;
  questions: Question[];
  answers: Record<string, AnswerValue>;
  currentQuestionId: string;
  isSubmitting: boolean;
  showIntroVideo: boolean;
  showPlayOverlay: boolean;
  isSettingsOpen: boolean;
  timerStart?: boolean;
  showTimer?: boolean;
  isAudioPlaying: boolean;
  audioError: string | null;
  audioRef: RefObject<HTMLAudioElement>;
  introVideoRef: RefObject<HTMLVideoElement>;
  introContainerRef: RefObject<HTMLDivElement>;
  isVideoAutoplayBlocked: boolean;
  onVideoAutoplayBlockedChange: (blocked: boolean) => void;
  onVideoEnded: () => void;
  onRequestFullscreen: () => Promise<void>;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onAudioPlay: () => void;
  onAudioPause: () => void;
  onAudioError: (message: string) => void;
  onPlayOverlayClose: () => void;
  onStartExam: () => void;
  onTimerExpire: () => void;
  onAnswerChange: (questionId: string, value: AnswerValue) => void;
  onQuestionClick: (questionId: string) => void;
  onQuestionFocus: (questionId: string) => void;
  onPartClick: (partNumber: number) => void;
  onSubmit: () => void;
  onConfirmSubmit: () => void;
  isReviewModalOpen: boolean;
  isConfirmModalOpen: boolean;
  onReviewClose: () => void;
  onReviewConfirm: () => void;
  onConfirmClose: () => void;
  sessionError: { type: string; message: string } | null;
  onSessionResolve: () => void;
  showPartResults?: boolean;
  onContinue?: () => void;
}

export function ListeningSection({
  assignment,
  section,
  parts,
  currentPartNumber,
  activePartIndex,
  startQuestion,
  endQuestion,
  currentPart,
  questions,
  answers,
  currentQuestionId,
  isSubmitting,
  showIntroVideo,
  showPlayOverlay,
  isSettingsOpen,
  isAudioPlaying,
  audioError,
  audioRef,
  introVideoRef,
  introContainerRef,
  isVideoAutoplayBlocked,
  onVideoAutoplayBlockedChange,
  onVideoEnded,
  onRequestFullscreen,
  onOpenSettings,
  onCloseSettings,
  onAudioPlay,
  onAudioPause,
  onAudioError,
  onPlayOverlayClose,
  onStartExam,
  onTimerExpire,
  onAnswerChange,
  onQuestionClick,
  onQuestionFocus,
  onPartClick,
  onSubmit,
  onConfirmSubmit,
  isReviewModalOpen,
  isConfirmModalOpen,
  onReviewClose,
  onReviewConfirm,
  onConfirmClose,
  sessionError,
  onSessionResolve,
  timerStart,
  showTimer = true,
  showPartResults = false,
  onContinue,
}: ListeningSectionProps) {
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [isAudioPrepared, setIsAudioPrepared] = useState(false);
  const [audioLoadProgress, setAudioLoadProgress] = useState(0);

  // Memoize audio source URL to prevent <audio> element re-mount on re-renders
  const audioSrc = useMemo(() => {
    if (!section.audioUrl) return '';
    return section.audioUrl.startsWith('http')
      ? section.audioUrl
      : `${API_BASE_URL}${section.audioUrl.startsWith('/') ? '' : '/'}${section.audioUrl}`;
  }, [section.audioUrl]);

  useEffect(() => {
    if (!showPlayOverlay || !audioSrc || !audioRef.current || audioError) {
      return;
    }

    const audio = audioRef.current;
    let fallbackProgressTimer: ReturnType<typeof setInterval> | null = null;
    let setupTimer: ReturnType<typeof setTimeout> | null = null;
    let cleaned = false;

    const stopFallbackProgress = () => {
      if (fallbackProgressTimer) {
        clearInterval(fallbackProgressTimer);
        fallbackProgressTimer = null;
      }
    };

    const markPrepared = () => {
      if (cleaned) {
        return;
      }
      setAudioLoadProgress(100);
      setIsPreparingAudio(false);
      setIsAudioPrepared(true);
      stopFallbackProgress();
    };

    const updateBufferedProgress = () => {
      if (cleaned) {
        return;
      }

      if (audio.buffered.length > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        const bufferedPercent = Math.min(
          100,
          Math.round((bufferedEnd / audio.duration) * 100),
        );

        setAudioLoadProgress((prev) => Math.max(prev, bufferedPercent));

        if (bufferedPercent >= 100 || audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
          markPrepared();
        }
      }
    };

    const handleProgress = () => {
      updateBufferedProgress();
    };

    const handleLoadedMetadata = () => {
      updateBufferedProgress();
    };

    const handleCanPlayThrough = () => {
      markPrepared();
    };

    const handleError = () => {
      if (cleaned) {
        return;
      }
      stopFallbackProgress();
      setIsPreparingAudio(false);
      setIsAudioPrepared(false);
    };

    audio.addEventListener('progress', handleProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('error', handleError);

    setupTimer = setTimeout(() => {
      if (cleaned) {
        return;
      }

      setIsPreparingAudio(true);
      setIsAudioPrepared(false);
      setAudioLoadProgress((prev) => (prev > 0 ? prev : 5));

      audio.preload = 'auto';
      if (audio.src !== audioSrc) {
        audio.src = audioSrc;
      }

      if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        markPrepared();
      } else {
        audio.load();
        fallbackProgressTimer = setInterval(() => {
          setAudioLoadProgress((prev) => {
            if (prev >= 90) {
              return prev;
            }
            return prev + 3;
          });
        }, 350);
      }
    }, 0);

    return () => {
      cleaned = true;
      if (setupTimer) {
        clearTimeout(setupTimer);
      }
      stopFallbackProgress();
      audio.removeEventListener('progress', handleProgress);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('error', handleError);
    };
  }, [audioError, audioRef, audioSrc, showPlayOverlay]);

  // Pause audio ONLY if a tab conflict occurs (anti-cheat/multi-tab prevention)
  useEffect(() => {
    if (sessionError?.type === 'tab_conflict' && audioRef.current && !audioRef.current.paused) {
      console.warn('Pausing audio due to tab conflict');
      audioRef.current.pause();
    }
  }, [sessionError, audioRef]);

  return (
    <div
      className="h-screen overflow-hidden bg-white flex flex-col notranslate exam-content"
      translate="no"
    >
      <div className="h-16 shrink-0">
        <ExamHeader
          title={section.title}
          remainingSeconds={assignment.remainingTime ?? section.duration * 60}
          sectionType="LISTENING"
          isAudioPlaying={isAudioPlaying}
          autoStart={timerStart && !showPlayOverlay && !sessionError}
          showTimer={showTimer}
          onTimerExpire={onTimerExpire}
          onOpenSettings={onOpenSettings}
        />
      </div>

      <PartBanner
        partNumber={currentPartNumber}
        startQuestion={startQuestion}
        endQuestion={endQuestion}
        type="LISTENING"
      />

      <div className="flex-1 pb-20 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-2 space-y-2">
          {audioSrc && (
            <audio
              ref={audioRef}
              src={audioSrc}
              onPause={onAudioPause}
              onPlay={onAudioPlay}
              onError={(event) => {
                const target = event.target as HTMLAudioElement;
                console.error('Audio Error:', target.error);
                onAudioError(
                  'Failed to load audio source. Please check your connection or contact support.'
                );
              }}
              preload="auto"
              className="hidden"
            />
          )}

          <div className="space-y-0">
            {currentPart && (
              <QuestionGroups
                questions={questions.filter((question) =>
                  currentPart.questions?.some(
                    (partQuestion) => partQuestion.id === question.id
                  )
                )}
                answers={answers}
                currentQuestionId={currentQuestionId}
                sectionType={section.type}
                onAnswerChange={onAnswerChange}
                onQuestionFocus={onQuestionFocus}
                showResults={showPartResults}
              />
            )}
          </div>
        </div>
      </div>

      {showPlayOverlay && (
        <div className="fixed inset-0 bg-[#333333] z-100 flex flex-col items-center justify-center text-white px-8 text-center overflow-hidden">
          <div className="w-32 h-32 mb-8 text-white opacity-90">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
          </div>

          <div className="max-w-2xl space-y-6">
            <h2 className="text-3xl font-bold mb-4">Listening Test</h2>

            {audioError ? (
              <div className="bg-red-900/40 border border-red-500 rounded-xl p-6 text-red-200">
                <p className="font-bold mb-2">Technical Error</p>
                <p>{audioError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <p className="text-xl font-medium leading-relaxed">
                  You will be listening to an audio clip during this test. You
                  will not be permitted to pause or rewind the audio while
                  answering the questions.
                </p>
                {isPreparingAudio ? (
                  <div className="max-w-lg mx-auto mt-3 rounded-2xl border border-white/20 bg-white/10 p-5">
                    <p className="text-base font-semibold text-white">Preparing audio...</p>
                    <p className="text-sm text-gray-200 mt-1">
                      Please wait while we fully load audio to prevent disconnections.
                    </p>

                    <div className="mt-4 h-2.5 w-full rounded-full bg-white/20 overflow-hidden">
                      <div
                        className="h-full bg-white transition-all duration-300"
                        style={{ width: `${audioLoadProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-300">{audioLoadProgress}% loaded</p>
                  </div>
                ) : (
                  <p className="text-lg text-gray-300">
                    Audio is ready. Click Play to begin.
                  </p>
                )}

                <button
                  onClick={async () => {
                    if (sessionError) return;
                    if (!isAudioPrepared) return;
                    if (!document.fullscreenElement) {
                      await onRequestFullscreen();
                    }
                    if (audioRef.current) {
                      const remainingSeconds = assignment.remainingTime;
                      const shouldResumeFromRemainingTime =
                        Boolean(assignment.fullMockSessionId) &&
                        assignment.status === "IN_PROGRESS" &&
                        typeof remainingSeconds === "number";

                      if (shouldResumeFromRemainingTime) {
                        const totalDurationSeconds = section.duration * 60;
                        const elapsedSeconds = Math.max(
                          0,
                          totalDurationSeconds - remainingSeconds,
                        );

                        if (elapsedSeconds > 0) {
                          console.log(
                            `Resuming audio at ${elapsedSeconds}s (Elapsed from ${totalDurationSeconds}s total)`,
                          );
                          audioRef.current.currentTime = elapsedSeconds;
                        } else {
                          audioRef.current.currentTime = 0;
                        }
                      } else {
                        // Self-study section/part restarts should always begin from 00:00.
                        audioRef.current.currentTime = 0;
                      }

                      audioRef.current
                        .play()
                        .then(() => {
                          onPlayOverlayClose();
                          onStartExam();
                        })
                        .catch((error) => {
                          console.error('Play failed:', error);
                          onAudioError(
                            'Could not start audio playback. The source may be unsupported or restricted.'
                          );
                        });
                    }
                  }}
                  disabled={!!sessionError || isPreparingAudio || !isAudioPrepared}
                  className={`mt-8 px-8 py-3 bg-black border border-white/20 rounded-lg flex items-center gap-3 hover:bg-gray-800 transition-all font-bold text-lg mx-auto group shadow-2xl ${
                    sessionError || isPreparingAudio || !isAudioPrepared
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg
                      className="w-5 h-5 text-black ml-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                  Play
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <BottomNav
        parts={parts}
        activePartIndex={activePartIndex !== -1 ? activePartIndex : 0}
        currentQuestionId={currentQuestionId}
        onQuestionClick={onQuestionClick}
        onPartClick={onPartClick}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
        showPartResults={showPartResults}
        onContinue={onContinue}
      />

      <ReviewAndConfirmModals
        isReviewOpen={isReviewModalOpen}
        onReviewClose={onReviewClose}
        onReviewConfirm={onReviewConfirm}
        isConfirmOpen={isConfirmModalOpen}
        onConfirmClose={onConfirmClose}
        onConfirm={onConfirmSubmit}
        parts={parts}
        answers={answers}
        isSubmitting={isSubmitting}
      />

      <SessionIssueModal sessionError={sessionError} onResolve={onSessionResolve} />

      <IntroVideoOverlay
        isOpen={showIntroVideo}
        sectionType={section.type}
        introVideoRef={introVideoRef}
        containerRef={introContainerRef}
        isAutoplayBlocked={isVideoAutoplayBlocked}
        onAutoplayBlockedChange={onVideoAutoplayBlockedChange}
        onEnded={onVideoEnded}
        onRequestFullscreen={onRequestFullscreen}
      />

      <SettingsModal isOpen={isSettingsOpen} onClose={onCloseSettings} />
    </div>
  );
}
