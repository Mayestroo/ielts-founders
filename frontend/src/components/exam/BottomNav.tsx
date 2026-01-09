'use client';

interface NavQuestion {
  id: string;
  number: string | number;
  isAnswered: boolean;
}

interface NavPart {
  number: number;
  questionCount: number;
  answeredCount: number;
  startQuestionNumber: number;
  questions: NavQuestion[];
}

interface BottomNavProps {
  parts: NavPart[];
  activePartIndex: number;
  currentQuestionId: string;
  onQuestionClick: (questionId: string) => void;
  onPartClick: (partNumber: number) => void;
  onSubmit: () => void;

  isSubmitting?: boolean;
  sectionType?: string;
}

export function BottomNav({ 
  parts, 
  activePartIndex,
  currentQuestionId,
  onQuestionClick, 
  onPartClick,
  onSubmit,

  isSubmitting = false,
  sectionType,
}: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-[52px] bg-white border-t border-gray-300 z-50 flex items-center shadow-[0_-2px_10px_rgba(0,0,0,0.05)] transition-colors hover:bg-gray-50">
      <div className="flex-1 flex items-center justify-between h-full">
        {/* Accordion Parts Navigation - Left when Part 1, Centered otherwise */}
        <div className={`flex-1 flex items-center h-full overflow-x-auto no-scrollbar ${sectionType === 'WRITING' || sectionType === 'LISTENING' || sectionType === 'READING' ? '' : 'px-8'}`}>
          {parts.map((part, index) => {
            const isActive = index === activePartIndex;
            const isWriting = sectionType === 'WRITING';
            
            return (
              <div
                key={part.number}
                onClick={() => onPartClick(part.number)}
                className={`
                  flex-1 flex items-center h-full px-2 cursor-pointer transition-colors
                  ${isWriting || (isActive && !isWriting) ? 'justify-start' : 'justify-center'}
                  ${isActive ? 'bg-white cursor-default' : 'hover:bg-gray-100'}
                `}
              >
                {isActive ? (
                  /* Expanded State */
                  <div className="flex items-center gap-4 px-2">
                    <span className="font-bold text-gray-900 whitespace-nowrap text-base">Part {part.number}</span>
                    {sectionType !== 'WRITING' && (
                      <div className="flex items-center text-sm gap-1">
                        {part.questions.map((q) => (
                          <button
                            key={q.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuestionClick(q.id);
                            }}
                            className={`
                              min-w-[20px] h-[34px] px-2 flex items-center justify-center text-[14px] whitespace-nowrap
                              ${currentQuestionId === q.id 
                                ? `border-[1.5px] rounded-md border-blue-400 font-bold ${q.isAnswered ? 'bg-green-500 text-white' : 'bg-white text-gray-900'}`
                                : q.isAnswered 
                                  ? 'bg-green-500 text-white font-bold rounded-md hover:bg-green-400 cursor-pointer'
                                  : 'text-gray-700 hover:text-black cursor-pointer hover:border hover:rounded-md hover:border-blue-400'
                              }
                            `}
                          >
                            {q.number}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Collapsed State */
                  <div className="flex items-center gap-3 py-1 group">
                    <span className="text-base font-bold text-gray-900">
                      Part {part.number}
                    </span>
                    <span className="text-sm text-gray-500">{part.answeredCount} of {part.questionCount}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit Button (Checkmark) */}
        <div className="flex items-center h-full shrink-0">
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="flex items-center justify-center w-[58px] h-full bg-gray-100 hover:bg-gray-300 disabled:bg-gray-200 border-l border-gray-300 cursor-pointer"
            title="Submit Section"
          >
            {isSubmitting ? (
              <svg className="animate-spin h-5 w-5 text-gray-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </nav>
  );
}

