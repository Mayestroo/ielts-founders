import { HighlightableText } from '@/components/exam/HighlightableText';
import { useEffect, useRef } from 'react';

interface ShortAnswerProps {
  id: string;
  questionText: string;
  wordLimit?: number;
  value: string;
  onChange: (value: string) => void;
  questionNumber: string | number;
  isActive?: boolean;
  onFocus?: () => void;
  sectionType?: string;
}

export function ShortAnswerQuestion({ 
  id, 
  questionText, 
  wordLimit = 3, 
  value, 
  onChange,
  questionNumber,
  isActive = false,
  onFocus,
  sectionType
}: ShortAnswerProps) {
  const textareaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isActive]);

  const wordCount = value.trim().split(/\s+/).filter(w => w).length;
  const isOverLimit = wordCount > wordLimit;

  return (
    <div className="py-4 ">
      <div className="flex items-start gap-3 mb-4">
        <span className={`shrink-0 min-w-[28px] h-7 px-1 flex items-center justify-center text-sm font-bold rounded-sm transition-all duration-200 whitespace-nowrap ${
            isActive 
            ? 'bg-white border-2 border-blue-400 text-black' 
            : 'bg-transparent border-2 border-transparent text-black'
        }`}>
          {questionNumber}
        </span>
        <div className="flex-1">
          {(sectionType === 'LISTENING' || sectionType === 'READING') ? (
            <div className="text-gray-900 font-medium text-base leading-relaxed">
              <HighlightableText 
                content={questionText} 
                initialHighlights={[]}
                onHighlightsChange={() => {}}
                inline={true}
              />
            </div>
          ) : (
            <p 
              className="text-gray-900 font-medium text-base leading-relaxed"
              dangerouslySetInnerHTML={{ 
                __html: questionText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />')
              }}
            />
          )}
        </div>
      </div>
      
      <div className="pl-10">
        <div className={`
          relative max-w-md transition-all duration-200 rounded-sm
          ${isActive 
            ? 'border border-[#2D8EFF] bg-white' 
            : 'border border-gray-800 bg-white'}
        `}>
          <input
            ref={textareaRef as any}
            type="text"
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            placeholder="Type your answer..."
            className={`
              w-full px-4 py-2 outline-none
              bg-transparent 
              text-gray-900 text-base font-normal
              placeholder:text-gray-400 placeholder:font-normal
            `}
            spellCheck="false"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            {...({ "data-gramm": "false" } as any)}
            {...({ "data-enable-grammarly": "false" } as any)}
          />
        </div>
      </div>
    </div>
  );
}
