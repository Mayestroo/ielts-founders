"use client";

import { HighlightableText } from "@/components/exam/HighlightableText";
import { Question } from "@/types";
import { useEffect, useRef, useState } from "react";

interface MatchingGroupProps {
  questions: Question[];
  options: { id: string; text: string }[];
  answers: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
  currentQuestionId: string;
  onQuestionClick: (questionId: string) => void;
  questionsLabel?: string;
  optionsLabel?: string;
  imageUrl?: string;
  sectionType?: string;
}

export function MatchingGroup({
  questions,
  options,
  answers,
  onChange,
  currentQuestionId,
  onQuestionClick,
  questionsLabel = "Questions",
  optionsLabel = "Options",
  imageUrl,
  sectionType,
}: MatchingGroupProps) {
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (currentQuestionId && scrollRefs.current[currentQuestionId]) {
      // Logic for scrolling to active question if needed
    }
  }, [currentQuestionId]);

  const handleDragStart = (e: React.DragEvent, optionId: string) => {
    e.dataTransfer.setData("text/plain", optionId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: React.DragEvent, questionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverId(questionId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, questionId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const optionId = e.dataTransfer.getData("text/plain");

    // Check if option is valid for this group (simple check: exists in options list)
    if ((options || []).some((opt) => opt.id === optionId)) {
      onChange(questionId, optionId);
    }
  };

  return (
    <div className="space-y-8">
      {/* Optional Map/Diagram Image */}
      {imageUrl && (
        <div className="w-full flex justify-center bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Map or Diagram"
            className="max-w-full h-auto object-contain max-h-125 rounded-lg shadow-sm"
          />
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-12 items-start py-6">
        {/* Items Column */}
        <div className="flex-1 w-full">
          <h4 className="text-base font-bold text-gray-900 mb-6">
            {questionsLabel}
          </h4>
          <div className="space-y-8">
            {(questions || []).map((q) => {
              const isActive = currentQuestionId === q.id;
              const dragOverIdValue = (dragOverId as string | null);
              const isDragOver = dragOverIdValue === q.id;
              const value = answers[q.id] || "";
              const isFilled = !!value;

              // Extract question number from id or number field
              const idMatch = q.id.match(/\d+/);
              const displayNum = idMatch
                ? idMatch[0]
                : (q as any).number;

              // Clean question text (remove [BLANK] or placeholders)
              const cleanText = (q.questionText || "")
                .replace(/[:\s]*\[BLANK\][:\s]*/i, "")
                .trim();

              return (
                <div
                  key={q.id}
                  id={`question-${q.id}`}
                  ref={(el) => {
                    scrollRefs.current[q.id] = el;
                  }}
                  className="flex items-center justify-between group gap-4"
                >
                  {sectionType === "LISTENING" || sectionType === "READING" ? (
                    <div className="text-[17px] text-gray-900 leading-snug max-w-[60%]">
                      <HighlightableText
                        content={cleanText}
                        initialHighlights={[]}
                        onHighlightsChange={() => {}}
                        inline={true}
                      />
                    </div>
                  ) : (
                    <span
                      className="text-[17px] text-gray-900 leading-snug max-w-[60%]"
                      dangerouslySetInnerHTML={{
                        __html: cleanText
                          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                          .replace(/\n/g, "<br />"),
                      }}
                    />
                  )}

                  {/* Dotted Drop Zone */}
                  <button
                    onClick={() => onQuestionClick(q.id)}
                    onDragOver={(e) => handleDragOver(e, q.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, q.id)}
                    className={`
                    relative flex items-center justify-center w-32 h-10
                    transition-all duration-200 rounded-lg border
                    ${
                      isFilled
                        ? "border-[#2D8EFF] bg-white ring-0 group/filled shadow-sm"
                        : "border-gray-800 bg-white hover:border-[#2D8EFF]"
                    }
                    ${
                      isActive && !isFilled
                        ? "border-[#2D8EFF] ring-1 ring-[#2D8EFF]/20"
                        : ""
                    }
                    ${isDragOver ? "scale-105 border-[#2D8EFF] bg-blue-50" : ""}
                  `}
                  >
                    {value ? (
                      <>
                        <span className="text-black font-normal text-lg">
                          {value}
                        </span>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onChange(q.id, "");
                          }}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover/filled:opacity-100 transition-opacity hover:bg-red-600 shadow-sm z-10"
                          title="Remove answer"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </div>
                      </>
                    ) : (
                      <span className="text-black font-bold text-sm select-none">
                        {displayNum}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Options Column */}
        <div className="w-full lg:w-72 shrink-0 sticky top-24">
          <h4 className="text-base font-bold text-gray-900 mb-6">
            {optionsLabel}
          </h4>
          <div className="flex flex-col gap-3">
            {(options || []).map((option) => {
              // Count how many times this option is used
              const usedCount = (questions || []).filter(
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
                    flex items-center gap-3 relative overflow-hidden group
                    ${
                      isUsed
                        ? "border-[#2D8EFF] hover:border-[#2D8EFF] hover:shadow-md cursor-grab active:cursor-grabbing"
                        : "border-gray-200 hover:border-black hover:shadow-md cursor-grab active:cursor-grabbing"
                    }
                  `}
                >
                  <span
                    className={`
                    shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold rounded transition-colors
                    ${
                      isUsed ? "bg-[#2D8EFF] text-white" : "bg-black text-white"
                    }
                  `}
                  >
                    {option.id}
                  </span>
                  <span
                    className={`text-[15px] font-medium leading-tight ${
                      isUsed ? "text-[#2D8EFF]" : "text-gray-700"
                    }`}
                  >
                    {option.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
