'use client';

import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { instructionAllowsOptionReuse } from '@/lib/optionReuse';
import { Question } from '@/types';
import { useState } from 'react';
import { FillBlankQuestion } from './FillBlankQuestion';

interface SummaryGroupProps {
  questions: Question[];
  answers: Record<string, any>;
  onChange: (questionId: string, value: any) => void;
  currentQuestionId: string;
  onQuestionClick: (questionId: string) => void;
  sectionType?: string;
  showResults?: boolean;
}

export function SummaryGroup({
  questions,
  answers,
  onChange,
  currentQuestionId,
  onQuestionClick,
  sectionType,
  showResults = false,
}: SummaryGroupProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  
  // Check if questions have options (use first question as reference)
  const firstQuestion = questions[0];
  const hasOptions = firstQuestion && 'options' in firstQuestion && Array.isArray((firstQuestion as any).options);
  const options = hasOptions ? (firstQuestion as any).options : [];
  const instruction =
    questions.find((question) =>
      typeof question.instruction === 'string' && question.instruction.trim().length > 0,
    )?.instruction || '';
  const canReuseOptions =
    instructionAllowsOptionReuse(instruction) || options.length < questions.length;
  const usedOptionIds = new Set(
    questions
      .map((question) => answers[question.id])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const availableOptions = canReuseOptions
    ? options
    : options.filter((option: any) => !usedOptionIds.has(option.id));

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, optionId: string) => {
    if (showResults) return;
    e.dataTransfer.setData('text/plain', optionId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, questionId: string) => {
    if (showResults) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverId(questionId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, questionId: string) => {
    if (showResults) return;
    e.preventDefault();
    setDragOverId(null);
    const optionId = e.dataTransfer.getData('text/plain');

    // Check if option is valid
    if (options.some((opt: any) => opt.id === optionId)) {
      onChange(questionId, optionId);
    }
  };

  // Group questions by line
  const lines: Question[][] = [];
  questions.forEach((q) => {
    if (q.isInSameLine && lines.length > 0) {
      lines[lines.length - 1].push(q);
    } else {
      lines.push([q]);
    }
  });

  return (
    <div className="mt-4">
      <div className="text-gray-800 text-[16px] leading-[34px]">
        {lines.map((lineQuestions, lineIndex) => {
          const firstQ = lineQuestions[0];
          const text = firstQ?.questionText || '';
          // Heuristic for structured blocks: starts with bullet/header or contains newlines
          const isBlock = text.includes('\n') || text.trim().startsWith('-') || text.trim().startsWith('**');
          
          return (
            <div 
              key={`line-${lineIndex}`} 
              className={isBlock ? "mb-4 block whitespace-pre-wrap" : "inline whitespace-normal"}
            >
              {lineQuestions.map((q) => {
                const isActive = currentQuestionId === q.id;
                const value = answers[q.id] || '';
                
                const idMatch = q.id.match(/\d+/);
                const displayNum = idMatch ? parseInt(idMatch[0]) : (q as any).number;
                const displayNumber = q.points > 1 ? `${displayNum}-${displayNum + q.points - 1}` : displayNum;

                // If has options, render as drop zone, otherwise text input
                if (hasOptions) {
                  const isDragOver = dragOverId === q.id;
                  const isFilled = !!value;
                  
                  const [beforeText, afterText] = q.questionText.split(/\[BLANK\]|\[blank\]/i);

                  return (
                    <span key={q.id} id={`question-${q.id}`} className="inline">
                      {/* Render text before blank */}
                      {beforeText && (
                        <span dangerouslySetInnerHTML={{
                          __html: sanitizeHtml(
                            beforeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                          )
                        }} />
                      )}
                      
                      {/* Drop zone for option */}
                      <div className="inline-flex flex-col items-center">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            if (!showResults) onQuestionClick(q.id);
                          }}
                          onDragOver={(e) => handleDragOver(e, q.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, q.id)}
                          disabled={showResults}
                          className={`
                            relative inline-flex items-center justify-center min-w-[110px] h-[28px] mx-1 align-middle -translate-y-px
                            transition-all duration-200 rounded-sm border
                            ${
                              showResults
                                ? (value === (q as any).correctAnswer)
                                  ? 'border-green-500 bg-green-50'
                                  : 'border-red-500 bg-red-50'
                                : isFilled
                                  ? 'border-[#2D8EFF] bg-blue-50/50 ring-0 group/filled shadow-sm'
                                  : 'border-gray-400 bg-white hover:border-[#2D8EFF]'
                            }
                            ${
                              isActive && !isFilled && !showResults
                                ? 'border-[#2D8EFF] ring-1 ring-[#2D8EFF]/20 shadow-sm'
                                : ''
                            }
                            ${isDragOver ? 'scale-105 border-[#2D8EFF] bg-blue-100' : ''}
                          `}
                        >
                          {value ? (
                            <>
                              <span className={`font-bold text-[14px] px-1.5 ${showResults ? (value === (q as any).correctAnswer ? 'text-green-700' : 'text-red-700') : 'text-black'}`}>
                                {value}
                              </span>
                              {!showResults && (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onChange(q.id, '');
                                  }}
                                  className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover/filled:opacity-100 transition-opacity hover:bg-red-600 shadow-sm z-10"
                                  title="Remove answer"
                                >
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-black font-bold text-xs select-none px-1.5">
                              {displayNumber}
                            </span>
                          )}
                        </button>
                        {showResults && value !== (q as any).correctAnswer && (
                          <span className="text-[10px] font-bold text-green-600 uppercase leading-none mt-0.5">
                            {(q as any).correctAnswer}
                          </span>
                        )}
                      </div>

                      {/* Render text after blank */}
                      {afterText && (
                        <span dangerouslySetInnerHTML={{
                          __html: sanitizeHtml(
                            afterText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                          )
                        }} />
                      )}
                    </span>
                  );
                }

                // Original text input for questions without options
                return (
                  <span key={q.id} id={`question-${q.id}`} className="inline">
                    <FillBlankQuestion
                      id={q.id}
                      questionText={q.questionText}
                      wordLimit={(q as any).wordLimit}
                      value={value}
                      onChange={(v) => onChange(q.id, v)}
                      questionNumber={displayNumber}
                      isActive={isActive}
                      onFocus={() => onQuestionClick(q.id)}
                      variant="inline"
                      sectionType={sectionType}
                      showResult={showResults}
                      correctAnswer={(q as any).correctAnswer}
                    />
                  </span>
                );
              })}
              {!isBlock && <span className="inline"> </span>}
            </div>
          );
        })}
      </div>


      {/* Options section - displayed below the summary text */}
      {hasOptions && options.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="text-base font-bold text-gray-900 mb-4">
            Options
          </h4>
          {availableOptions.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {availableOptions.map((option: any) => {
                return (
                  <div
                    key={option.id}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, option.id)}
                    onClick={() => {
                      if (currentQuestionId) {
                        onChange(currentQuestionId, option.id);
                      }
                    }}
                    className="px-4 py-2.5 rounded-lg border bg-white shadow-sm transition-all select-none flex items-center gap-3 relative overflow-hidden group cursor-grab active:cursor-grabbing border-gray-200 hover:border-black hover:shadow-md"
                  >
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold rounded transition-colors bg-black text-white">
                      {option.id}
                    </span>
                    <span className="text-[15px] font-medium leading-tight text-gray-700">
                      {option.text}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">All options are used.</p>
          )}
        </div>
      )}
    </div>
  );
}
