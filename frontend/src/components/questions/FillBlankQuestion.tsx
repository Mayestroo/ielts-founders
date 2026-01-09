import { HighlightableText } from '@/components/exam/HighlightableText';
import { useEffect, useRef } from 'react';

interface FillBlankProps {
  id: string;
  questionText: string;
  wordLimit?: number;
  value: string;
  onChange: (value: string) => void;
  questionNumber: string | number;
  isActive?: boolean;
  onFocus?: () => void;
  hideBullet?: boolean;
  variant?: 'default' | 'inline';
  sectionType?: string;
}

export function FillBlankQuestion({ 
  id, 
  questionText, 
  wordLimit = 3, 
  value, 
  onChange,
  questionNumber,
  isActive = false,
  onFocus,
  hideBullet = false,
  variant = 'default',
  sectionType
}: FillBlankProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  const wordCount = value.trim().split(/\s+/).filter(w => w).length;
  const isOverLimit = wordCount > wordLimit;

  // Split text by placeholder (e.g., _____, [BLANK], or [blank])
  const parts = questionText.split(/_{3,}|\[BLANK\]|\[blank\]/i);

  const renderInput = () => (
    <span className="inline-flex mx-1 align-middle">
      <div className={`
        relative flex items-center min-w-[80px] h-[22px] transition-all duration-200 
        ${isActive 
          ? 'bg-white border border-[#2D8EFF]' 
          : 'bg-white border border-gray-400'}
        rounded-sm group/input
      `}>
        {/* Question Number - Centered and hidden when value exists */}
        {!value && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold pointer-events-none transition-colors text-black">
            {questionNumber}
          </span>
        )}
        
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          className={`
            w-full h-full px-2 py-0 outline-none text-center
            font-normal text-gray-900 bg-transparent text-base
            ${isActive ? 'caret-black' : ''}
          `}
          spellCheck="false"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          {...({ "data-gramm": "false" } as any)}
          {...({ "data-enable-grammarly": "false" } as any)}
        />
        
        {isOverLimit && (
          <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-[10px] font-bold rounded shadow-lg whitespace-nowrap z-10 pointer-events-none">
            {wordCount}/{wordLimit} words
          </span>
        )}
      </div>
    </span>
  );

  const textContent = parts.map((part, index) => (
    <span key={index}>
      {part && (
        (sectionType === 'LISTENING' || sectionType === 'READING') ? (
          <HighlightableText 
            content={part} 
            initialHighlights={[]}
            onHighlightsChange={() => {}}
            inline={true}
            className="leading-[34px]!"
          />
        ) : (
          <span dangerouslySetInnerHTML={{ __html: part.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }} />
        )
      )}
      {index < parts.length - 1 && renderInput()}
    </span>
  ));

  if (variant === 'inline') {
    return (
      <span className="inline">
        {textContent}
      </span>
    );
  }

  return (
    <div className="py-1 flex items-start group">
      {/* Bullet Point Design */}
      {!hideBullet && (
        <span className="mr-3 mt-2 block w-1.5 h-1.5 rounded-full bg-black shrink-0" />
      )}
      
      <div className="flex-1 text-gray-800 text-base leading-[34px]!" style={{ lineHeight: '34px' }}>
        {textContent}
      </div>
    </div>
  );
}
