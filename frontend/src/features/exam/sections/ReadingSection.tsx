'use client';

import { BottomNav, ExamHeader, PartBanner, ResizablePanel, SettingsModal } from '@/components/exam';
import { HighlightableText } from '@/components/exam/HighlightableText';
import { ExamAssignment, ExamSection, Question } from '@/types';
import { RefObject } from 'react';
import { IntroVideoOverlay } from '../components/IntroVideoOverlay';
import { QuestionGroups } from '../components/QuestionGroups';
import { ReviewAndConfirmModals } from '../components/ReviewAndConfirmModals';
import { SessionIssueModal } from '../components/SessionIssueModal';
import { AnswerValue, ExamPart, Passage } from '../types';

interface ReadingSectionProps {
  assignment: ExamAssignment & { remainingTime?: number };
  section: ExamSection;
  parts: ExamPart[];
  currentPartNumber: number;
  activePartIndex: number;
  startQuestion: number;
  endQuestion: number;
  currentPart?: ExamPart;
  passages: Passage[];
  questions: Question[];
  answers: Record<string, AnswerValue>;
  currentQuestionId: string;
  rightPanelRef: RefObject<HTMLDivElement>;
  isSubmitting: boolean;
  showIntroVideo: boolean;
  isSettingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  introVideoRef: RefObject<HTMLVideoElement>;
  introContainerRef: RefObject<HTMLDivElement>;
  isVideoAutoplayBlocked: boolean;
  timerStart?: boolean;
  showTimer?: boolean;
  onVideoAutoplayBlockedChange: (blocked: boolean) => void;
  onVideoEnded: () => void;
  onRequestFullscreen: () => Promise<void>;
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

export function ReadingSection({
  assignment,
  section,
  parts,
  currentPartNumber,
  activePartIndex,
  startQuestion,
  endQuestion,
  currentPart,
  passages,
  questions,
  answers,
  currentQuestionId,
  rightPanelRef,
  isSubmitting,
  showIntroVideo,
  isSettingsOpen,
  onOpenSettings,
  onCloseSettings,
  introVideoRef,
  introContainerRef,
  isVideoAutoplayBlocked,
  onVideoAutoplayBlockedChange,
  onVideoEnded,
  onRequestFullscreen,
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
}: ReadingSectionProps) {
  return (
    <div className="h-screen overflow-hidden bg-white flex flex-col exam-content">
      <ExamHeader
        title={section.title}
        remainingSeconds={assignment.remainingTime ?? section.duration * 60}
        sectionType={section.type}
        onTimerExpire={onTimerExpire}
        autoStart={timerStart && !sessionError}
        showTimer={showTimer}
        onOpenSettings={onOpenSettings}
      />
      <SettingsModal isOpen={isSettingsOpen} onClose={onCloseSettings} />

      <div className="flex-1 pt-16 pb-16 min-h-0 flex flex-col">
        <PartBanner
          partNumber={currentPartNumber}
          startQuestion={startQuestion}
          endQuestion={endQuestion}
          type="READING"
        />
        <div className="flex-1 min-h-0">
          <ResizablePanel
            leftPanel={
              <div className="h-full overflow-y-auto">
                {passages
                  .filter((_, index) => index === activePartIndex)
                  .map((passage) => (
                    <div key={passage.id} className="p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        {passage.title}
                      </h2>
                      <div className="prose prose-gray max-w-none">
                        <HighlightableText
                          content={passage.content.trim()}
                          initialHighlights={[]}
                          onHighlightsChange={() => {}}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            }
            rightPanel={
              <div
                ref={rightPanelRef}
                className="h-full overflow-y-auto p-6 space-y-4 bg-white"
              >
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
            }
          />
        </div>
      </div>

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
    </div>
  );
}
