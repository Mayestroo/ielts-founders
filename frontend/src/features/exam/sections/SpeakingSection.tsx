'use client';

import { BottomNav, ExamHeader, PartBanner, SettingsModal } from '@/components/exam';
import { api } from '@/lib/api';
import { ExamAssignment, ExamSection, Question } from '@/types';
import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { IntroVideoOverlay } from '../components/IntroVideoOverlay';
import { SessionIssueModal } from '../components/SessionIssueModal';
import { AnswerValue, ExamPart } from '../types';

const formatDuration = (totalSeconds: number): string => {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0
    ? Math.floor(totalSeconds)
    : 0;
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
  const seconds = String(safeSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const resolveRecorderMimeType = (): string | null => {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return null;
  }

  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveAudioUploadMeta = (
  mimeType: string | undefined,
): { mimeType: string; extension: string } => {
  const normalized = (mimeType || '').toLowerCase();

  if (normalized.includes('mp4') || normalized.includes('m4a')) {
    return { mimeType: 'audio/mp4', extension: 'm4a' };
  }

  if (normalized.includes('ogg') || normalized.includes('opus')) {
    return { mimeType: 'audio/ogg', extension: 'ogg' };
  }

  if (normalized.includes('wav')) {
    return { mimeType: 'audio/wav', extension: 'wav' };
  }

  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }

  return { mimeType: 'audio/webm', extension: 'webm' };
};

type MicrophonePermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported';

const getMicrophoneErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Microphone permission is blocked. Please allow access and try again.';
    }

    if (error.name === 'NotFoundError') {
      return 'No microphone device was found.';
    }

    if (error.name === 'NotReadableError') {
      return 'Microphone is already in use by another app or tab.';
    }

    if (error.name === 'SecurityError') {
      return 'Microphone access requires HTTPS (or localhost).';
    }
  }

  return 'Microphone permission denied or unavailable.';
};

interface SpeakingSectionProps {
  assignment: ExamAssignment & { remainingTime?: number };
  section: ExamSection;
  parts: ExamPart[];
  activePartIndex: number;
  currentQuestionId: string;
  answers: Record<string, AnswerValue>;
  showIntroVideo: boolean;
  isSettingsOpen: boolean;
  timerStart?: boolean;
  showTimer?: boolean;
  isVideoAutoplayBlocked: boolean;
  introVideoRef: RefObject<HTMLVideoElement>;
  introContainerRef: RefObject<HTMLDivElement>;
  onVideoAutoplayBlockedChange: (blocked: boolean) => void;
  onVideoEnded: () => void;
  onRequestFullscreen: () => Promise<void>;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onTimerExpire: () => void;
  onAnswerChange: (questionId: string, value: AnswerValue) => void;
  onQuestionClick: (questionId: string) => void;
  onPartClick: (partNumber: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError?: string;
  sessionError: { type: string; message: string } | null;
  onSessionResolve: () => void;
  showPartResults?: boolean;
  onContinue?: () => void;
}

export function SpeakingSection({
  assignment,
  section,
  parts,
  activePartIndex,
  currentQuestionId,
  answers,
  showIntroVideo,
  isSettingsOpen,
  isVideoAutoplayBlocked,
  introVideoRef,
  introContainerRef,
  onVideoAutoplayBlockedChange,
  onVideoEnded,
  onRequestFullscreen,
  onOpenSettings,
  onCloseSettings,
  onTimerExpire,
  onAnswerChange,
  onQuestionClick,
  onPartClick,
  onSubmit,
  isSubmitting,
  submitError,
  sessionError,
  onSessionResolve,
  timerStart,
  showTimer = true,
  showPartResults = false,
  onContinue,
}: SpeakingSectionProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState('audio/webm');
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [microphonePermissionState, setMicrophonePermissionState] =
    useState<MicrophonePermissionState>('unknown');
  const [isRequestingMicPermission, setIsRequestingMicPermission] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const activeQuestionIdRef = useRef<string>('s1');

  const speakingQuestions = useMemo(
    () => {
      const questions = ((section.questions || []) as Question[]).slice(0, 3);
      if (questions.length > 0) {
        return questions;
      }

      return [
        {
          id: 's1',
          type: 'SHORT_ANSWER',
          questionText: 'Part 1: Personal introduction and familiar topics.',
          points: 1,
          instruction:
            'Answer brief questions about yourself and daily life in a natural way.',
        } as Question,
        {
          id: 's2',
          type: 'SHORT_ANSWER',
          questionText: 'Part 2: Individual long turn.',
          points: 1,
          instruction:
            'Speak for 1-2 minutes about the cue card topic with examples and details.',
        } as Question,
        {
          id: 's3',
          type: 'SHORT_ANSWER',
          questionText: 'Part 3: Discussion and abstract questions.',
          points: 1,
          instruction:
            'Give developed opinions and reasons about broader ideas related to Part 2.',
        } as Question,
      ];
    },
    [section.questions],
  );

  const normalizedActivePartIndex =
    activePartIndex >= 0 && activePartIndex < speakingQuestions.length
      ? activePartIndex
      : 0;
  const activeQuestion = speakingQuestions[normalizedActivePartIndex];
  const activeQuestionId = activeQuestion?.id || 's1';

  const activeAudioUrl =
    typeof answers[activeQuestionId] === 'string' ? (answers[activeQuestionId] as string) : '';
  const playbackAudioUrl = activeAudioUrl || localPreviewUrl || '';

  const uploadedCount = speakingQuestions.filter((question) => {
    const value = answers[question.id];
    return typeof value === 'string' && value.trim().length > 0;
  }).length;

  const partInstruction = useMemo(() => {
    const partNumber = normalizedActivePartIndex + 1;
    if (partNumber === 1) {
      return 'Part 1: Answer short personal questions clearly and naturally.';
    }
    if (partNumber === 2) {
      return 'Part 2: Speak continuously for up to 2 minutes on the prompt.';
    }
    return 'Part 3: Discuss wider ideas and support your opinions with reasons.';
  }, [normalizedActivePartIndex]);

  const bannerInstruction = useMemo(() => {
    const questionText = activeQuestion?.questionText?.trim();
    if (!questionText) {
      return partInstruction;
    }

    const partPrefix = new RegExp(
      `^part\\s*${normalizedActivePartIndex + 1}\\s*[:.-]?\\s*`,
      'i',
    );
    const cleaned = questionText.replace(partPrefix, '').trim();

    return cleaned.length > 0 ? cleaned : questionText;
  }, [activeQuestion?.questionText, normalizedActivePartIndex, partInstruction]);

  const speakingPromptTitle =
    activeQuestion?.questionText?.trim() || `Part ${normalizedActivePartIndex + 1}`;

  const speakingPromptBody =
    activeQuestion?.instruction?.trim() ||
    section.description?.trim() ||
    'Please answer the speaking prompt clearly.';

  const clearRecordingTicker = () => {
    if (recordingIntervalRef.current !== null) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const revokePreviewUrl = (url: string | null) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  const hasUploadedCurrentPart = activeAudioUrl.trim().length > 0;
  const hasRecordedCurrentPart = Boolean(recordedBlob) || hasUploadedCurrentPart;
  const isMicrophoneReady = microphonePermissionState === 'granted';

  useEffect(() => {
    activeQuestionIdRef.current = activeQuestionId;
  }, [activeQuestionId]);

  useEffect(() => {
    if (!navigator.permissions?.query) {
      return;
    }

    let active = true;
    let permissionStatus: PermissionStatus | null = null;

    const updatePermissionState = () => {
      if (!active || !permissionStatus) {
        return;
      }

      const state = permissionStatus.state;
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        setMicrophonePermissionState(state);
      }
    };

    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (!active) {
          return;
        }

        permissionStatus = status;
        updatePermissionState();
        permissionStatus.onchange = updatePermissionState;
      })
      .catch(() => {
        if (active) {
          setMicrophonePermissionState('unknown');
        }
      });

    return () => {
      active = false;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      clearRecordingTicker();
      revokePreviewUrl(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  useEffect(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }

    setRecordingError(null);
    setAudioDurationSeconds(0);
    setRecordedBlob(null);
    setRecordedMimeType('audio/webm');
    setRecordingElapsedSeconds(0);
    clearRecordingTicker();
    setIsRecording(false);
    setLocalPreviewUrl((prev) => {
      revokePreviewUrl(prev);
      return null;
    });
    chunksRef.current = [];
  }, [activeQuestionId]);

  const requestMicrophoneStream = async (): Promise<MediaStream | null> => {
    if (!window.isSecureContext) {
      setMicrophonePermissionState('denied');
      setRecordingError('Microphone access requires HTTPS (or localhost).');
      return null;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermissionState('unsupported');
      setRecordingError('Microphone is not available in this browser.');
      return null;
    }

    if (typeof MediaRecorder === 'undefined') {
      setMicrophonePermissionState('unsupported');
      setRecordingError('Your browser does not support audio recording.');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicrophonePermissionState('granted');
      return stream;
    } catch (error) {
      const message = getMicrophoneErrorMessage(error);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setMicrophonePermissionState('denied');
      } else if (error instanceof DOMException && error.name === 'SecurityError') {
        setMicrophonePermissionState('denied');
      }
      setRecordingError(message);
      return null;
    }
  };

  const requestMicrophonePermission = async () => {
    setRecordingError(null);
    setIsRequestingMicPermission(true);

    const stream = await requestMicrophoneStream();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setIsRequestingMicPermission(false);
  };

  const beginRecording = async () => {
    setRecordingError(null);

    setRecordedBlob(null);
    setRecordingElapsedSeconds(0);
    setLocalPreviewUrl((prev) => {
      revokePreviewUrl(prev);
      return null;
    });

    try {
      const stream = await requestMicrophoneStream();
      if (!stream) {
        return;
      }

      const preferredMimeType = resolveRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      const partIdAtStart = activeQuestionId;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const fallbackMimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: fallbackMimeType });
        if (blob.size > 0 && activeQuestionIdRef.current === partIdAtStart) {
          const resolvedMeta = resolveAudioUploadMeta(blob.type || fallbackMimeType);
          setRecordedMimeType(resolvedMeta.mimeType);
          setRecordedBlob(blob);
          setLocalPreviewUrl((prev) => {
            revokePreviewUrl(prev);
            return URL.createObjectURL(blob);
          });
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      clearRecordingTicker();
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingElapsedSeconds((previous) => previous + 1);
      }, 1000);
    } catch (error) {
      setRecordingError(getMicrophoneErrorMessage(error));
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }
    clearRecordingTicker();
    recorder.stop();
    setIsRecording(false);
  };

  const uploadRecording = async () => {
    setRecordingError(null);
    if (!recordedBlob) {
      setRecordingError('Please record your answer before uploading.');
      return;
    }

    try {
      setIsUploading(true);
      const uploadMeta = resolveAudioUploadMeta(recordedBlob.type || recordedMimeType);
      const file = new File([recordedBlob], `${activeQuestionId}-${Date.now()}.${uploadMeta.extension}`, {
        type: uploadMeta.mimeType,
      });
      const uploaded = await api.uploadSpeakingAudio(file);

      onAnswerChange(activeQuestionId, uploaded.url);
      if (audioDurationSeconds > 0) {
        onAnswerChange(`${activeQuestionId}__durationSeconds`, String(audioDurationSeconds));
      }

      if (activeQuestionId === 's1') {
        onAnswerChange('speakingAudioUrl', uploaded.url);
        if (audioDurationSeconds > 0) {
          onAnswerChange('audioDurationSeconds', String(audioDurationSeconds));
        }
      }
    } catch (error) {
      setRecordingError(
        error instanceof Error ? error.message : 'Failed to upload speaking audio.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = () => {
    const missingParts = speakingQuestions
      .map((question, index) => ({
        part: index + 1,
        value: answers[question.id],
      }))
      .filter(
        (entry) => typeof entry.value !== 'string' || entry.value.trim().length === 0,
      )
      .map((entry) => entry.part);

    if (missingParts.length > 0) {
      setRecordingError(`Please upload recordings for Part ${missingParts.join(', Part ')}.`);
      return;
    }

    onSubmit();
  };

  const handlePartSwitch = (partNumber: number) => {
    if (isRecording) {
      setRecordingError('Please stop recording before changing parts.');
      return;
    }

    onPartClick(partNumber);
  };

  const handleQuestionSwitch = (questionId: string) => {
    if (isRecording) {
      setRecordingError('Please stop recording before changing parts.');
      return;
    }

    onQuestionClick(questionId);
  };

  return (
    <div className="h-screen overflow-hidden bg-white flex flex-col exam-content">
      <div className="h-16 shrink-0">
        <ExamHeader
          title={section.title}
          remainingSeconds={assignment.remainingTime ?? section.duration * 60}
          sectionType="SPEAKING"
          onTimerExpire={onTimerExpire}
          autoStart={timerStart && !sessionError}
          showTimer={showTimer}
          onOpenSettings={onOpenSettings}
        />
      </div>

      <PartBanner
        partNumber={normalizedActivePartIndex + 1}
        startQuestion={normalizedActivePartIndex + 1}
        endQuestion={normalizedActivePartIndex + 1}
        type="SPEAKING"
        instruction={bannerInstruction}
      />

      <div className="flex-1 overflow-y-auto px-5 pb-20">
        <div className="mx-auto max-w-4xl rounded-3xl border border-gray-200 bg-gradient-to-br from-white via-white to-gray-50 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19v2" />
                </svg>
              </span>
              <h3 className="text-lg font-semibold text-gray-900">
                Speaking Prompt - Part {normalizedActivePartIndex + 1}
              </h3>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              Uploaded {uploadedCount}/{speakingQuestions.length}
            </span>
          </div>
          <p className="mt-3 text-base font-semibold text-gray-900">{speakingPromptTitle}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{speakingPromptBody}</p>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
            {!isMicrophoneReady && (
              <button
                type="button"
                onClick={() => void requestMicrophonePermission()}
                disabled={isRecording || isUploading || isRequestingMicPermission}
                className="inline-flex items-center gap-2 rounded-xl border border-(--button-brand-color) bg-white px-4 py-2.5 text-sm font-semibold text-(--button-brand-color) transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19v2" />
                </svg>
                {isRequestingMicPermission ? 'Checking Microphone...' : 'Allow Microphone'}
              </button>
            )}

            {!isRecording ? (
              <button
                type="button"
                onClick={beginRecording}
                disabled={!isMicrophoneReady || isUploading || isRequestingMicPermission}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19v2" />
                </svg>
                {hasRecordedCurrentPart ? 'Record Again' : 'Start Recording'}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                Stop Recording
              </button>
            )}

            <button
              type="button"
              onClick={uploadRecording}
              disabled={isUploading || isRecording || !recordedBlob}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 9l5-5 5 5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 16.5a3.5 3.5 0 01-3.5 3.5h-9A3.5 3.5 0 014 16.5" />
              </svg>
              {isUploading ? 'Uploading...' : 'Upload Recording'}
            </button>

              <span className="text-xs text-gray-500">
                {isRecording
                  ? `Recording ${formatDuration(recordingElapsedSeconds)}`
                  : !isMicrophoneReady
                    ? 'Allow microphone first, then start recording.'
                  : hasUploadedCurrentPart
                    ? 'Uploaded. You can record again to replace it.'
                    : recordedBlob
                      ? 'Ready to upload this take.'
                      : 'Tap Start Recording, then Upload Recording.'}
              </span>
            </div>
          </div>

          {recordingError && <p className="mt-3 text-sm text-red-600">{recordingError}</p>}
          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

          {isSubmitting && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              Submitting and grading your speaking answers. This can take up to 1-2 minutes.
            </div>
          )}

          {playbackAudioUrl && (
            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">Preview Audio</p>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  hasUploadedCurrentPart
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {hasUploadedCurrentPart ? 'Uploaded' : 'Local Preview'}
                </span>
              </div>
              <audio
                ref={localAudioRef}
                controls
                className="mt-2 w-full"
                src={playbackAudioUrl}
                onLoadedMetadata={() => {
                  if (localAudioRef.current?.duration) {
                    const duration = Math.floor(localAudioRef.current.duration);
                    setAudioDurationSeconds(duration);
                    onAnswerChange(`${activeQuestionId}__durationSeconds`, String(duration));

                    if (activeQuestionId === 's1') {
                      onAnswerChange('audioDurationSeconds', String(duration));
                    }
                  }
                }}
              />
              {audioDurationSeconds > 0 && (
                <p className="mt-2 text-xs text-gray-500">Duration: {formatDuration(audioDurationSeconds)}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <BottomNav
        parts={
          parts.length > 0
            ? parts
            : speakingQuestions.map((question, index) => ({
                number: index + 1,
                questionCount: 1,
                answeredCount:
                  typeof answers[question.id] === 'string' &&
                  (answers[question.id] as string).trim().length > 0
                    ? 1
                    : 0,
                startQuestionNumber: index + 1,
                questions: [
                  {
                    id: question.id,
                    number: index + 1,
                    isAnswered:
                      typeof answers[question.id] === 'string' &&
                      (answers[question.id] as string).trim().length > 0,
                  },
                ],
              }))
        }
        activePartIndex={normalizedActivePartIndex}
        currentQuestionId={currentQuestionId || activeQuestionId}
        onQuestionClick={handleQuestionSwitch}
        onPartClick={handlePartSwitch}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting || isUploading}
        sectionType="SPEAKING"
        showPartResults={showPartResults}
        onContinue={onContinue}
      />

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
      <SessionIssueModal sessionError={sessionError} onResolve={onSessionResolve} />
    </div>
  );
}
