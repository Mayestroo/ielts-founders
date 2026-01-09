import { useEffect, useRef } from 'react';

interface WritingTaskProps {
  id: string;
  taskDescription: string;
  value: string;
  onChange: (value: string) => void;
  minWords?: number;
  onFocus?: () => void;
}

export function WritingTask({ 
  id, 
  taskDescription, 
  value, 
  onChange,
  minWords = 150,
  onFocus
}: WritingTaskProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const wordCount = value.trim().split(/\s+/).filter(w => w).length;
  const isUnderLimit = wordCount < minWords;
  const progress = Math.min((wordCount / minWords) * 100, 100);

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder="Start writing your response here..."
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          translate="no"
          className="
            w-full h-full p-4 border border-black
            hover:border-[#5B9BD5] focus:border-[#5B9BD5]
            bg-white text-black
            placeholder-gray-400 resize-none transition-all duration-300
            text-[18px] leading-tight outline-none
          "
        />
        <div className="absolute -bottom-6 right-0">
          <span className="text-base text-black">
            Words: {wordCount}
          </span>
        </div>
      </div>
    </div>
  );
}
