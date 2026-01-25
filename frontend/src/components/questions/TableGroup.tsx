'use client';

import { Question } from '@/types';
import { HighlightableText } from '../exam/HighlightableText';
import { FillBlankQuestion } from './FillBlankQuestion';

interface TableGroupProps {
  questions: Question[];
  answers: Record<string, any>;
  onChange: (questionId: string, value: any) => void;
  currentQuestionId: string;
  onQuestionClick: (questionId: string) => void;
  sectionType?: string;
}

export function TableGroup({
  questions,
  answers,
  onChange,
  currentQuestionId,
  onQuestionClick,
  sectionType
}: TableGroupProps) {
  const tableData = questions.length > 0 ? (questions[0] as any).tableData : null;

  if (tableData) {
    let questionIndex = 0;

    return (
      <div className="w-full overflow-x-auto border-2 border-black rounded-lg bg-white">
        {tableData.title && (
          <div className="p-3 text-center font-bold text-lg border-b-2 border-black bg-gray-50 text-black">
            <HighlightableText 
              content={tableData.title} 
              initialHighlights={[]}
              onHighlightsChange={() => {}}
              inline={true}
            />
          </div>
        )}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {tableData.headers.map((header: string, i: number) => (
                <th key={i} className="p-3 border-r-2 last:border-r-0 border-black text-left font-bold text-black min-w-[120px] whitespace-pre-wrap">
                  <HighlightableText 
                    content={header} 
                    initialHighlights={[]}
                    onHighlightsChange={() => {}}
                    inline={true}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.rows.map((row: string[], rowIndex: number) => (
              <tr key={rowIndex} className="border-t-2 border-black">
                {row.map((cell: string, cellIndex: number) => {
                  // Count how many [BLANK] are in this cell
                  const blanksInCell = (cell.match(/\[BLANK\]|\[blank\]/gi) || []).length;
                  const cellQuestionIndices: number[] = [];
                  
                  for (let i = 0; i < blanksInCell; i++) {
                    cellQuestionIndices.push(questionIndex++);
                  }

                  let currentCellQuestionOffset = 0;

                  return (
                    <td key={cellIndex} className="p-4 border-r-2 last:border-r-0 border-black text-black whitespace-pre-wrap leading-[34px]">
                      {cell.split(/\[BLANK\]|\[blank\]/gi).map((part, partIdx, array) => (
                        <span key={partIdx} className="inline">
                          <HighlightableText 
                            content={part} 
                            initialHighlights={[]}
                            onHighlightsChange={() => {}}
                            inline={true}
                          />
                          {partIdx < array.length - 1 && (() => {
                            const qIdx = cellQuestionIndices[currentCellQuestionOffset++];
                            const q = questions[qIdx];
                            if (!q) return null;

                            const isActive = currentQuestionId === q.id;
                            const value = answers[q.id] || '';
                            const idMatch = q.id.match(/\d+/);
                            const displayNum = idMatch ? parseInt(idMatch[0]) : (q as any).number || (qIdx + 1);

                            return (
                              <FillBlankQuestion
                                key={q.id}
                                id={q.id}
                                questionText="[BLANK]"
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
                            );
                          })()}
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Fallback to list-style table (existing logic)
  return (
    <div className="border-2 border-black rounded-lg overflow-hidden">
      <div className="grid grid-cols-1 divide-y-2 divide-black bg-white">
        {questions.map((q, index) => {
          const isActive = currentQuestionId === q.id;
          const value = answers[q.id] || '';
          
          // Extract numeric portion from ID (e.g., "q6" -> 6) or fallback to index
          const idMatch = q.id.match(/\d+/);
          const displayNum = idMatch ? parseInt(idMatch[0]) : (q as any).number;
          const displayNumber = q.points > 1 ? `${displayNum}-${displayNum + q.points - 1}` : displayNum;

          // Attempt to split by colon to create a label/value structure
          const parts = q.questionText.split(/:\s*/);
          const hasLabel = parts.length > 1;
          const label = hasLabel ? parts[0] : '';
          const content = hasLabel ? parts.slice(1).join(': ') : q.questionText;

          return (
            <div 
              key={q.id} 
              id={`question-${q.id}`}
              onClick={() => onQuestionClick(q.id)}
              className={`
                flex flex-col md:flex-row transition-colors cursor-pointer
                ${isActive ? 'bg-blue-50/50' : 'hover:bg-gray-50'}
              `}
            >
              {hasLabel && (
                <div className="md:w-1/3 p-4 bg-gray-100 border-b md:border-b-0 md:border-r-2 border-black flex items-center font-bold text-black" >
                  {(sectionType === 'LISTENING' || sectionType === 'READING') ? (
                    <HighlightableText 
                      content={label} 
                      initialHighlights={[]}
                      onHighlightsChange={() => {}}
                      inline={true}
                    />
                  ) : (
                    label
                  )}
                </div>
              )}
              
              <div className={`flex-1 p-4 ${!hasLabel ? 'w-full' : ''}`}>
                 <FillBlankQuestion
                    id={q.id}
                    questionText={content}
                    wordLimit={(q as any).wordLimit}
                    value={value}
                    onChange={(v) => onChange(q.id, v)}
                    questionNumber={displayNumber}
                    isActive={isActive}
                    onFocus={() => onQuestionClick(q.id)}
                    sectionType={sectionType}
                  />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
