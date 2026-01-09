'use client';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

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

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  parts: NavPart[];
  answers: Record<string, any>;
  isLoading?: boolean;
}

export function ReviewModal({
  isOpen,
  onClose,
  onConfirm,
  parts,
  answers,
  isLoading = false,
}: ReviewModalProps) {
  const totalQuestions = parts.reduce((sum, part) => sum + part.questionCount, 0);
  const totalAnswered = parts.reduce((sum, part) => sum + part.answeredCount, 0);
  const isComplete = totalAnswered === totalQuestions;

  const formatAnswer = (ans: any) => {
    if (!ans) return null;
    if (Array.isArray(ans)) return ans.join(', ');
    if (typeof ans === 'object') return JSON.stringify(ans);
    return String(ans);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Review Your Answers" width="max-w-3xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-gray-50 p-6 rounded-2xl">
          <div>
            <p className="text-sm text-gray-500 font-bold uppercase tracking-widest mb-1">Total Progress</p>
            <p className="text-3xl font-black text-black">
              {totalAnswered} <span className="text-gray-300 font-normal">/ {totalQuestions}</span>
            </p>
          </div>
          <div className="text-right">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black uppercase tracking-tight ${
              isComplete ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isComplete ? 'bg-green-500' : 'bg-orange-500 animate-pulse'}`} />
              {isComplete ? 'Ready to Submit' : `${totalQuestions - totalAnswered} Questions Left`}
            </div>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto pr-4 custom-scrollbar">
          <div className="space-y-8">
            {parts.map((part) => (
              <div key={part.number} className="space-y-4">
                <div className="flex items-center gap-4">
                  <h4 className="text-lg font-black text-black whitespace-nowrap">Part {part.number}</h4>
                  <div className="h-px bg-gray-100 flex-1" />
                  <span className="text-sm font-bold text-gray-400">{part.answeredCount} of {part.questionCount}</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {part.questions.map((q) => {
                    const answer = formatAnswer(answers[q.id]);
                    return (
                      <div
                        key={q.id}
                        className={`
                          flex items-center gap-4 p-3 rounded-xl border transition-all
                          ${q.isAnswered 
                            ? 'bg-white border-gray-200 shadow-sm' 
                            : 'bg-gray-50 border-gray-100'
                          }
                        `}
                      >
                        <div className={`
                          w-10 h-10 shrink-0 flex items-center justify-center text-sm font-black rounded-lg
                          ${q.isAnswered ? 'bg-black text-white' : 'bg-white text-gray-300 border border-gray-200'}
                        `}>
                          {q.number}
                        </div>
                        <div className="flex-1 min-w-0">
                          {q.isAnswered ? (
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {answer}
                            </p>
                          ) : (
                            <p className="text-sm font-medium text-gray-300 italic">
                              No answer provided
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row gap-4">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1 h-14 border-2 border-gray-100 text-gray-600 font-bold hover:bg-gray-50 rounded-2xl"
            disabled={isLoading}
          >
            Go Back & Edit
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            className="flex-1 h-14 bg-black hover:bg-gray-800 text-white border-none text-xl font-black rounded-2xl shadow-xl shadow-black/10 active:scale-95 transition-all"
            isLoading={isLoading}
          >
            Submit Exam
          </Button>
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }
      `}</style>
    </Modal>
  );
}
