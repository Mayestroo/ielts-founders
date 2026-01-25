'use client';

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
}

export function SummaryGroup({
  questions,
  answers,
  onChange,
  currentQuestionId,
  onQuestionClick,
  sectionType
}: SummaryGroupProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  
  // Check if questions have options (use first question as reference)
  const firstQuestion = questions[0];
  const hasOptions = firstQuestion && 'options' in firstQuestion && Array.isArray((firstQuestion as any).options);
  const options = hasOptions ? (firstQuestion as any).options : [];

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, optionId: string) => {
    e.dataTransfer.setData('text/plain', optionId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, questionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverId(questionId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, questionId: string) => {
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
                          __html: beforeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        }} />
                      )}
                      
                      {/* Drop zone for option */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          onQuestionClick(q.id);
                        }}
                        onDragOver={(e) => handleDragOver(e, q.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, q.id)}
                        className={`
                          relative inline-flex items-center justify-center min-w-[110px] h-[28px] mx-1 align-middle -translate-y-px
                          transition-all duration-200 rounded-sm border
                          ${
                            isFilled
                              ? 'border-[#2D8EFF] bg-blue-50/50 ring-0 group/filled shadow-sm'
                              : 'border-gray-400 bg-white hover:border-[#2D8EFF]'
                          }
                          ${
                            isActive && !isFilled
                              ? 'border-[#2D8EFF] ring-1 ring-[#2D8EFF]/20 shadow-sm'
                              : ''
                          }
                          ${isDragOver ? 'scale-105 border-[#2D8EFF] bg-blue-100' : ''}
                        `}
                      >
                        {value ? (
                          <>
                            <span className="text-black font-bold text-[14px] px-1.5">
                              {value}
                            </span>
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
                          </>
                        ) : (
                          <span className="text-black font-bold text-xs select-none px-1.5">
                            {displayNumber}
                          </span>
                        )}
                      </button>

                      {/* Render text after blank */}
                      {afterText && (
                        <span dangerouslySetInnerHTML={{
                          __html: afterText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
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
          <div className="flex flex-wrap gap-3">
            {options.map((option: any) => {
              // Count how many times this option is used
              const usedCount = questions.filter(
                (q) => answers[q.id] === option.id
              ).length;
              const isUsed = usedCount > 0;

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
                  className={`
                    px-4 py-2.5 rounded-lg border bg-white shadow-sm transition-all select-none
                    flex items-center gap-3 relative overflow-hidden group cursor-grab active:cursor-grabbing
                    ${
                      isUsed
                        ? 'border-[#2D8EFF] hover:border-[#2D8EFF] hover:shadow-md'
                        : 'border-gray-200 hover:border-black hover:shadow-md'
                    }
                  `}
                >
                  <span
                    className={`
                      shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold rounded transition-colors
                      ${
                        isUsed ? 'bg-[#2D8EFF] text-white' : 'bg-black text-white'
                      }
                    `}
                  >
                    {option.id}
                  </span>
                  <span
                    className={`text-[15px] font-medium leading-tight ${
                      isUsed ? 'text-[#2D8EFF]' : 'text-gray-700'
                    }`}
                  >
                    {option.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
