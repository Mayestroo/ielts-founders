'use client';

import { Question } from '@/types';
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
        {lines.map((lineQuestions, lineIndex) => (
          <div key={`line-${lineIndex}`} className="mb-2 last:mb-0">
            {lineQuestions.map((q) => {
              const isActive = currentQuestionId === q.id;
              const value = answers[q.id] || '';
              
              const idMatch = q.id.match(/\d+/);
              const displayNum = idMatch ? parseInt(idMatch[0]) : (q as any).number;
              const displayNumber = q.points > 1 ? `${displayNum}-${displayNum + q.points - 1}` : displayNum;

              return (
                <span key={q.id} id={`question-${q.id}`}>
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
                  {' '}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
