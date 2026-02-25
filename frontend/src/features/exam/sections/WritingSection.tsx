'use client';

import { BottomNav, ExamHeader, PartBanner, ResizablePanel, SettingsModal } from '@/components/exam';
import { WritingTask } from '@/components/questions';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { ExamAssignment, ExamSection, Question } from '@/types';
import { RefObject } from 'react';
import { IntroVideoOverlay } from '../components/IntroVideoOverlay';
import { SessionIssueModal } from '../components/SessionIssueModal';
import { AnswerValue, ExamPart } from '../types';

interface WritingSectionProps {
  assignment: ExamAssignment & { remainingTime?: number };
  section: ExamSection;
  parts: ExamPart[];
  currentPartNumber: number;
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
  onQuestionFocus: (questionId: string) => void;
  onQuestionClick: (questionId: string) => void;
  onPartClick: (partNumber: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  sessionError: { type: string; message: string } | null;
  onSessionResolve: () => void;
  showPartResults?: boolean;
  onContinue?: () => void;
}

export function WritingSection({
  assignment,
  section,
  parts,
  currentPartNumber,
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
  onQuestionFocus,
  onQuestionClick,
  onPartClick,
  onSubmit,
  isSubmitting,
  sessionError,
  onSessionResolve,
  timerStart,
  showTimer = true,
  showPartResults = false,
  onContinue,
}: WritingSectionProps) {
  const questions = section.questions as Question[];
  const activeQuestionIndex = activePartIndex < questions.length ? activePartIndex : 0;
  const activeQuestion = questions[activeQuestionIndex];
  const writingAnswer = (answers[activeQuestion.id] || '') as string;
  const displayTaskNumber =
    currentPartNumber || parts[activePartIndex]?.number || activeQuestionIndex + 1;

  const instructionLines = activeQuestion.instruction
    ? activeQuestion.instruction
        .replace(/Write at least\s*\**\d+\s*words\**\.?/gi, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  const minWords = activeQuestion.instruction?.match(/(\d+)\s*words/i)?.[1]
    ? parseInt(activeQuestion.instruction.match(/(\d+)\s*words/i)![1])
    : 150;

  const bannerInstruction =
    displayTaskNumber === 1
      ? 'You should spend about 20 minutes on this task. Write at least 150 words.'
      : 'You should spend about 40 minutes on this task. Write at least 250 words.';

  return (
    <div className="h-screen overflow-hidden bg-white flex flex-col exam-content">
      <div className="h-16 shrink-0">
        <ExamHeader
          title={section.title}
          remainingSeconds={assignment.remainingTime ?? section.duration * 60}
          sectionType="WRITING"
          onTimerExpire={onTimerExpire}
          autoStart={timerStart && !sessionError}
          showTimer={showTimer}
          onOpenSettings={onOpenSettings}
        />
      </div>

      <PartBanner
        partNumber={displayTaskNumber}
        startQuestion={displayTaskNumber}
        endQuestion={displayTaskNumber}
        type="WRITING"
        instruction={bannerInstruction}
      />

      <div className="flex-1 pb-16 min-h-0">
        <ResizablePanel
          leftPanel={
            <div className="h-full overflow-y-auto p-6">
              <div className="prose prose-gray max-w-none">
                <p className="font-bold text-black text-base mb-4">
                  {activeQuestion.questionText}
                </p>
                {activeQuestion.imageUrl && (
                  <img
                    src={activeQuestion.imageUrl}
                    alt="Task Image"
                    className="w-full h-auto mb-6 border border-gray-200 rounded-lg bg-white"
                  />
                )}
                {instructionLines.map((line, index) => (
                  <p
                    key={index}
                    className={`text-black text-base ${index === 0 ? 'font-bold' : ''} mb-4`}
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                      ),
                    }}
                  />
                ))}
              </div>
            </div>
          }
          rightPanel={
            <WritingTask
              id={activeQuestion.id}
              taskDescription={activeQuestion.questionText}
              value={writingAnswer}
              onChange={(value) => onAnswerChange(activeQuestion.id, value)}
              minWords={minWords}
              onFocus={() => onQuestionFocus(activeQuestion.id)}
            />
          }
        />
      </div>

      <BottomNav
        parts={parts}
        activePartIndex={activePartIndex !== -1 ? activePartIndex : 0}
        currentQuestionId={currentQuestionId}
        onQuestionClick={onQuestionClick}
        onPartClick={onPartClick}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
        sectionType="WRITING"
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
