"use client";

import { HighlightableText } from "@/components/exam/HighlightableText";

interface TrueFalseProps {
  id: string;
  questionText: string;
  variant: "TRUE_FALSE_NOT_GIVEN" | "YES_NO_NOT_GIVEN";
  value: string;
  onChange: (value: string) => void;
  questionNumber: string | number;
  isActive?: boolean;
  onFocus?: () => void;
  sectionType?: string;
}

export function TrueFalseQuestion({
  id,
  questionText,
  variant,
  value,
  onChange,
  questionNumber,
  isActive = false,
  onFocus,
  sectionType,
}: TrueFalseProps) {
  const options =
    variant === "TRUE_FALSE_NOT_GIVEN"
      ? ["TRUE", "FALSE", "NOT GIVEN"]
      : ["YES", "NO", "NOT GIVEN"];

  return (
    <div className="py-4 ">
      <div className="flex items-start gap-3 mb-4">
        <span
          className={`shrink-0 min-w-7 h-7 px-1 flex items-center justify-center text-sm font-bold rounded-sm transition-all duration-200 whitespace-nowrap ${
            isActive
              ? "bg-white border-2 border-blue-400 text-black"
              : "bg-transparent border-2 border-transparent text-black"
          }`}
        >
          {questionNumber}
        </span>
        {sectionType === "LISTENING" || sectionType === "READING" ? (
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
              __html: questionText
                .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                .replace(/\n/g, "<br />"),
            }}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 pl-10">
        {options.map((option) => (
          <label
            key={option}
            className={`flex items-center gap-3 cursor-pointer group px-3 py-2 rounded-lg transition-all ${
              value === option ? "bg-blue-50" : "hover:bg-gray-50"
            }`}
          >
            <div className="relative flex items-center justify-center">
              <input
                type="radio"
                name={`q-${id}`}
                checked={value === option}
                onChange={() => {
                  onChange(option);
                  onFocus?.();
                }}
                className="peer appearance-none w-5 h-5 rounded-full border-2 border-gray-300 checked:border-blue-400 checked:bg-blue-400 transition-all cursor-pointer"
              />
              <div className="absolute w-2.5 h-2.5 rounded-full bg-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
            </div>
            <span
              className={`text-base tracking-wide uppercase transition-colors ${
                value === option ? "text-black" : "text-gray-700"
              }`}
            >
              {option.replace("_", " ")}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
