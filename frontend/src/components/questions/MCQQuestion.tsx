'use client';

import { HighlightableText } from '@/components/exam/HighlightableText';

interface MCQProps {
  id: string;
  questionText: string;
  options: { id: string; text: string }[];
  isMultiple?: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  questionNumber: string | number;
  isActive?: boolean;
  onFocus?: () => void;
  sectionType?: string;
}

export function MCQQuestion({ 
  id, 
  questionText, 
  options, 
  isMultiple = false, 
  value, 
  onChange,
  questionNumber,
  isActive = false,
  onFocus,
  sectionType
}: MCQProps) {
  const handleChange = (optionId: string) => {
    if (isMultiple) {
      const currentValues = Array.isArray(value) ? value : [];
      if (currentValues.includes(optionId)) {
        onChange(currentValues.filter(v => v !== optionId));
      } else {
        onChange([...currentValues, optionId]);
      }
    } else {
      onChange(optionId);
    }
  };

  const isSelected = (optionId: string) => {
    if (isMultiple) {
      return Array.isArray(value) && value.includes(optionId);
    }
    return value === optionId;
  };

  return (
    <div className="py-4 ">
      <div className="flex items-start gap-3 mb-4">
         <span className={`shrink-0 min-w-7 h-7 px-1 flex items-center justify-center text-sm font-bold rounded-sm transition-all duration-200 whitespace-nowrap ${
            isActive 
            ? 'bg-white border-2 border-blue-400 text-black' 
            : 'bg-transparent border-2 border-transparent text-black'
        }`}>
          {questionNumber}
        </span>
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
      
      <div className="flex flex-col gap-1 pl-10">
        {options.map((option) => (
          <label
            key={option.id}
            className={`flex items-center gap-3 cursor-pointer group px-3 py-2 rounded-lg transition-all ${isSelected(option.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
          >
            <div className="relative flex items-center justify-center">
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={`q-${id}`}
                checked={isSelected(option.id)}
                onChange={() => {
                  handleChange(option.id);
                  onFocus?.();
                }}
                className={`
                  peer appearance-none w-5 h-5 border-2 border-gray-300 
                  checked:border-blue-400 checked:bg-blue-400 transition-all cursor-pointer
                  ${isMultiple ? 'rounded-md' : 'rounded-full'}
                `}
              />
              {isMultiple ? (
                <div className="absolute opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none text-white">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="absolute w-2.5 h-2.5 rounded-full bg-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
              )}
            </div>
            <span className={`text-base transition-colors ${isSelected(option.id) ? 'text-black' : 'text-gray-700 group-hover:text-black'}`}>
              {option.text}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
