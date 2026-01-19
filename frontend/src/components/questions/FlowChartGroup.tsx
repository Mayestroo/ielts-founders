'use client';

import { Question } from '@/types';
import { FillBlankQuestion } from './FillBlankQuestion';

interface FlowChartGroupProps {
  questions: Question[];
  answers: Record<string, any>;
  onChange: (questionId: string, value: any) => void;
  currentQuestionId: string;
  onQuestionClick: (questionId: string) => void;
  sectionType?: string;
}

import { useState } from 'react';
import { HighlightableText } from '../exam/HighlightableText';

export function FlowChartGroup({
  questions,
  answers,
  onChange,
  currentQuestionId,
  onQuestionClick,
  sectionType
}: FlowChartGroupProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const firstQ = questions[0];
  const flowchartData = firstQ ? (firstQ as any).flowchartData : null;
  const options = firstQ ? (firstQ as any).options as { id: string; text: string }[] | undefined : undefined;

  let questionIndex = 0;

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
    const optionId = e.dataTransfer.getData('text/plain').toUpperCase();
    
    // Check if option is valid (A-I)
    if (options?.some(opt => opt.id.toUpperCase() === optionId)) {
        onChange(questionId, optionId);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8">
      <div className="flex flex-col lg:flex-row gap-12 lg:items-start justify-center min-h-[400px]">
        {/* Flowchart (Left) */}
        <div className="relative flex-1 max-w-2xl">


        {/* Title */}
        {flowchartData?.title && (
          <h2 className="text-center font-bold text-xl mb-12 text-black uppercase tracking-tight">
            <HighlightableText 
              content={flowchartData.title} 
              initialHighlights={[]}
              onHighlightsChange={() => {}}
              inline={true}
            />
          </h2>
        )}

        {/* Vertical connecting line */}
        <div className="absolute left-1/2 -translate-x-1/2 top-12 bottom-0 w-0.5 bg-black" />
        
        <div className="space-y-12 relative z-10">
          {(flowchartData?.steps || questions).map((step: any, index: number) => {
            const isStepQuestion = flowchartData ? (step.isQuestion !== false) : true;
            
            let q: any = null;
            if (isStepQuestion) {
              q = flowchartData ? questions[questionIndex++] : step;
            }

            if (isStepQuestion && !q) return null;

            const isActive = q && currentQuestionId === q.id;
            const isDragOver = q && dragOverId === q.id;
            const value = q ? (answers[q.id] || '') : '';
            
            const idMatch = q?.id?.match(/\d+/);
            const displayNum = q ? (idMatch ? parseInt(idMatch[0]) : (q as any).number) : null;

            return (
              <div key={index} className="relative flex flex-col items-center">
                 {/* Arrow Head */}
                 {index > 0 && (
                   <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-black bg-white rounded-full p-1 border border-black shadow-sm">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M19 12l-7 7-7-7" />
                      </svg>
                   </div>
                 )}

                <div 
                  onClick={() => q && onQuestionClick(q.id)}
                  onDragOver={(e) => q && handleDragOver(e, q.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => q && handleDrop(e, q.id)}
                  className={`
                    w-full max-w-xl bg-white border-2 p-5 rounded-xl transition-all duration-200 
                    ${isStepQuestion ? 'cursor-pointer' : 'cursor-default text-center'}
                    ${isActive 
                      ? 'border-[#2D8EFF] shadow-lg ring-1 ring-[#2D8EFF]/20' 
                      : 'border-black shadow-sm'}
                    ${isDragOver ? 'border-[#2D8EFF] bg-blue-50 scale-[1.02]' : ''}
                    ${!isStepQuestion ? 'bg-gray-50 italic font-medium' : 'hover:border-gray-600'}
                  `}
                >
                  {isStepQuestion ? (
                    <div className="flex flex-wrap items-center justify-center gap-x-2 text-center w-full">
                      <FillBlankQuestion
                        id={q.id}
                        questionText={flowchartData ? step.text : q.questionText}
                        wordLimit={(q as any).wordLimit}
                        value={value}
                        onChange={(v) => onChange(q.id, v)}
                        questionNumber={displayNum}
                        isActive={isActive}
                        onFocus={() => onQuestionClick(q.id)}
                        variant="inline"
                        hideBullet={true}
                        sectionType={sectionType}
                      />
                    </div>
                  ) : (
                    <div className="text-gray-800">
                      <HighlightableText 
                        content={step.text} 
                        initialHighlights={[]}
                        onHighlightsChange={() => {}}
                        inline={true}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {options && (
        <div className="w-full lg:w-72 shrink-0 lg:sticky lg:top-10 z-20 h-fit">
          <div className="bg-white border-2 border-black rounded-lg p-6 shadow-sm max-h-[80vh] overflow-y-auto">
              <div className="flex flex-col gap-4">
                {options.map((opt) => (
                  <div 
                    key={opt.id} 
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, opt.id)}
                    onClick={() => {
                      if (currentQuestionId) onChange(currentQuestionId, opt.id);
                    }}
                    className="flex items-center gap-3 cursor-grab active:cursor-grabbing hover:bg-gray-50 p-2 rounded-lg border border-transparent hover:border-gray-200 transition-all group"
                  >
                    <span className="font-bold bg-black text-white w-7 h-7 flex items-center justify-center rounded text-sm shrink-0 group-hover:scale-110 transition-transform shadow-sm">
                      {opt.id}
                    </span>
                    <span className="text-[15px] font-medium text-gray-800">
                      {opt.text}
                    </span>
                  </div>
                ))}
          </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
