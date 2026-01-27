'use client';

import { Badge, Button, Card, CardBody, CardHeader, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { generateWritingDOCX } from '@/lib/generateDOCX';
import { ExamResult, User } from '@/types';
import React, { useEffect, useMemo, useState } from 'react';

interface AiEvaluation {
  bandScore: number;
  taskAchievement: { score: number; feedback: string };
  coherenceAndCohesion: { score: number; feedback: string };
  lexicalResource: { score: number; feedback: string };
  grammaticalRangeAndAccuracy: { score: number; feedback: string };
  overallFeedback: string;
  strengths: string[];
  areasForImprovement: string[];
}

export default function ResultsPage() {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [selectedResult, setSelectedResult] = useState<ExamResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [aiEvaluation, setAiEvaluation] = useState<AiEvaluation | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStatus, setAiStatus] = useState('');
  const [successModal, setSuccessModal] = useState<{ isOpen: boolean; bandScore: number }>({
    isOpen: false,
    bandScore: 0,
  });

  // UX Grouping View state
  const [selectedGroup, setSelectedGroup] = useState<{ student: User; results: ExamResult[]; latestDate: string } | null>(null);
  const [showSelectedStudentModal, setShowSelectedStudentModal] = useState(false);

  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Grouping Logic
  const groupedResults = useMemo(() => {
    // Perform client-side filtering
    const filtered = results.filter(result => {
      const student = result.student!;
      const matchesSearch = 
        (student.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
         student.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         student.username.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesType = !typeFilter || result.section?.type === typeFilter;
      
      return matchesSearch && matchesType;
    });

    const groups: Record<string, { student: User; results: ExamResult[]; latestDate: string }> = {};
    
    filtered.forEach((result) => {
      const studentId = result.studentId;
      if (!groups[studentId]) {
        groups[studentId] = {
          student: result.student!,
          results: [],
          latestDate: result.submittedAt as string,
        };
      }
      groups[studentId].results.push(result);
      if (new Date(result.submittedAt) > new Date(groups[studentId].latestDate)) {
        groups[studentId].latestDate = result.submittedAt as string;
      }
    });

    return Object.values(groups).sort((a, b) => 
      new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime()
    );
  }, [results, searchTerm, typeFilter]);


  const loadResults = async () => {
    setIsLoading(true);
    try {
      const skip = (page - 1) * pageSize;
      const { results, total } = await api.getResults(skip, pageSize);
      setResults(results);
      setTotal(total);
    } catch (err) {
      console.error('Failed to load results:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadResults();
  }, [page]);

  const handleViewDetails = async (id: string) => {
    setDetailLoading(true);
    setShowModal(true);
    setShowSelectedStudentModal(false); // Close student list so breakdown is visible
    setAiEvaluation(null);
    setAiError(null);
    try {
      const result = await api.getResult(id);
      setSelectedResult(result);
      const existingEval = result.feedback || result.answers?._aiEvaluation;
      if (existingEval) {
        setAiEvaluation(existingEval as AiEvaluation);
      }
    } catch (err) {
      console.error('Failed to load result details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedResult(null);
    setAiEvaluation(null);
    setAiError(null);
    // Re-open student list modal after closing breakdown
    if (selectedGroup) {
      setShowSelectedStudentModal(true);
    }
  };

  const handleEvaluateWithAI = async () => {
    if (!selectedResult) return;
    
    setAiLoading(true);
    setAiError(null);
    setAiProgress(5);
    setAiStatus('Connecting to AI Service...');

    let progress = 5;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 5;
      if (progress > 95) progress = 95;
      setAiProgress(Math.floor(progress));
    }, 1000);

    try {
      const response = await api.evaluateWriting(selectedResult.id);
      clearInterval(progressInterval);
      setAiProgress(100);
      setAiStatus('Evaluation complete!');
      setAiEvaluation(response.aiEvaluation || response.feedback);
      
      setSelectedResult(prev => prev ? {
        ...prev,
        score: response.score ?? response.bandScore,
        totalScore: response.totalScore ?? 9,
        bandScore: response.bandScore,
        feedback: response.aiEvaluation || response.feedback
      } : null);
      
      setTimeout(() => loadResults(), 500);
      setSuccessModal({ isOpen: true, bandScore: response.bandScore });
    } catch (err) {
      clearInterval(progressInterval);
      setAiError(err instanceof Error ? err.message : 'Failed to evaluate with AI');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDownloadWritingDOCX = async () => {
    if (!selectedResult || selectedResult.section?.type !== 'WRITING') return;
    
    setDocxLoading(true);
    try {
      const answers = selectedResult.answers || {};
      await generateWritingDOCX({
        student: selectedResult.student!,
        sectionTitle: selectedResult.section?.title || 'Writing Section',
        task1: answers['w1'] || answers['writing'],
        task2: answers['w2'],
        submittedAt: selectedResult.submittedAt,
      });
    } catch (err) {
      console.error('Failed to generate DOCX:', err);
      alert('Failed to generate DOCX file.');
    } finally {
      setDocxLoading(false);
    }
  };

  const isAnswerCorrect = (studentAnswer: any, correctAnswer: any, type: string) => {
    if (!studentAnswer || !correctAnswer) return false;
    if (type === 'MCQ_MULTIPLE' && Array.isArray(studentAnswer) && Array.isArray(correctAnswer)) {
       return studentAnswer.length === correctAnswer.length && studentAnswer.every((a: any) => correctAnswer.includes(a));
    }
    return JSON.stringify(studentAnswer) === JSON.stringify(correctAnswer) || String(studentAnswer).toLowerCase().trim() === String(correctAnswer).toLowerCase().trim();
  };

  const formatAnswer = (answer: any, type: string) => {
    if (answer === undefined || answer === null || answer === '-') return '-';
    if (type === 'MCQ_MULTIPLE' && Array.isArray(answer)) return answer.map((a: any) => String(a).toUpperCase()).join(', ');
    if (type === 'MCQ_SINGLE' || type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN') return String(answer).toUpperCase();
    if (typeof answer === 'object') return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
    return String(answer);
  };

  const statusVariants: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
    ASSIGNED: 'info',
    IN_PROGRESS: 'warning',
    SUBMITTED: 'success',
  };

  const sectionVariants: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
    READING: 'info',
    LISTENING: 'warning',
    WRITING: 'success',
  };

  const renderQuestions = () => {
    if (selectedResult?.section?.type === 'WRITING') {
      const answers = selectedResult.answers || {};
      const writingTasks = [];
      if (answers['w1']) writingTasks.push({ id: 'Task 1', response: answers['w1'] });
      if (answers['w2']) writingTasks.push({ id: 'Task 2', response: answers['w2'] });
      if (answers['writing'] && writingTasks.length === 0) writingTasks.push({ id: 'Writing Task', response: answers['writing'] });

      return (
        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-start gap-4">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="flex-1">
              <p className="font-medium text-blue-900 dark:text-blue-100">Reviewing Student Writing</p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">Check responses below and use AI Evaluation for a estimated IELTS score based on official criteria.</p>
            </div>
            <Button 
              onClick={handleDownloadWritingDOCX} 
              disabled={docxLoading} 
              size="sm" 
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              {docxLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent mr-2" />
              ) : (
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              )}
              {docxLoading ? 'Generating...' : 'Download DOCX'}
            </Button>
          </div>

          {writingTasks.map(task => (
            <div key={task.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-2 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-500">{task.id}</span>
                <span className="text-xs text-gray-400">{task.response.split(/\s+/).filter(Boolean).length} words</span>
              </div>
              <div className="p-6">
                <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-relaxed text-[17px]">{task.response}</p>
              </div>
            </div>
          ))}

          {/* AI Evaluation Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Evaluation</h3>
              
            {selectedResult?.section?.type === 'WRITING' && (
                <Button 
                  onClick={handleEvaluateWithAI} 
                  disabled={aiLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {aiLoading ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      Evaluating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {aiEvaluation ? 'Re-evaluate with AI' : 'Evaluate with AI'}
                    </>
                  )}
                </Button>
              )}
            </div>

            {aiLoading && (
              <div className="mb-6 space-y-3 animate-in fade-in duration-300">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium flex items-center">
                    <div className="h-4 w-4 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mr-2" />
                    {aiStatus}
                  </span>
                  <span className="text-gray-500 font-bold">{aiProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(79,70,229,0.5)]" 
                    style={{ width: `${aiProgress}%` }} 
                  />
                </div>
              </div>
            )}

            {aiError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-lg mb-4">
                {aiError}
              </div>
            )}

            {aiEvaluation && (
              <div className="space-y-6 animate-in fade-in duration-500">
                {/* Check if multi-task evaluation */}
                {(aiEvaluation as any).tasks ? (
                  <div className="space-y-8">
                     {/* Overall Band Score Card */}
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Overall Band Score</h4>
                          <p className="text-indigo-700 dark:text-indigo-300 text-sm">Weighted Average (Task 2 counts double)</p>
                        </div>
                        <div className="h-16 w-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-600/20">
                          {aiEvaluation.bandScore}
                        </div>
                      </div>
                    </div>

                    {/* Task Tabs/Sections */}
                    {Object.entries((aiEvaluation as any).tasks).map(([taskId, evalData]: [string, any]) => (
                      <div key={taskId} className="border-t border-gray-200 dark:border-gray-700 pt-6">
                         <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{taskId} Evaluation</h4>
                         
                         {/* Individual Task Feedback */}
                         <div className="space-y-4">
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                               <p className="text-gray-700 dark:text-gray-300 italic border-l-4 border-indigo-300 pl-4 py-1">
                                 "{evalData.overallFeedback}"
                               </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                               {[
                                 { label: 'Task Achievement', data: evalData.taskAchievement },
                                 { label: 'Coherence & Cohesion', data: evalData.coherenceAndCohesion },
                                 { label: 'Lexical Resource', data: evalData.lexicalResource },
                                 { label: 'Grammar', data: evalData.grammaticalRangeAndAccuracy },
                               ].map((criterion) => (
                                 <div key={criterion.label} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                                   <div className="flex justify-between items-center mb-2">
                                     <h5 className="font-semibold text-gray-900 dark:text-white">{criterion.label}</h5>
                                     <Badge variant={
                                       criterion.data.score >= 7 ? 'success' : 
                                       criterion.data.score >= 6 ? 'info' : 
                                       'warning'
                                     } size="sm">
                                       Band {criterion.data.score}
                                     </Badge>
                                   </div>
                                   <p className="text-sm text-gray-600 dark:text-gray-400">{criterion.data.feedback}</p>
                                 </div>
                               ))}
                            </div>
                            
                            {/* Strengths & Improvements */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5">
                                <h5 className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200 mb-3">Strengths</h5>
                                <ul className="space-y-2">
                                  {evalData.strengths.map((item: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
                                <h5 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200 mb-3">Areas for Improvement</h5>
                                <ul className="space-y-2">
                                  {evalData.areasForImprovement.map((item: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Estimated Band Score</h4>
                        <p className="text-indigo-700 dark:text-indigo-300 text-sm">Based on official IELTS criteria</p>
                      </div>
                      <div className="h-16 w-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-600/20">
                        {aiEvaluation.bandScore}
                      </div>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 italic border-l-4 border-indigo-300 pl-4 py-1">
                      "{aiEvaluation.overallFeedback}"
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: 'Task Achievement', data: aiEvaluation.taskAchievement },
                      { label: 'Coherence & Cohesion', data: aiEvaluation.coherenceAndCohesion },
                      { label: 'Lexical Resource', data: aiEvaluation.lexicalResource },
                      { label: 'Grammar', data: aiEvaluation.grammaticalRangeAndAccuracy },
                    ].map((criterion) => (
                      <div key={criterion.label} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-center mb-2">
                          <h5 className="font-semibold text-gray-900 dark:text-white">{criterion.label}</h5>
                          <Badge variant={
                            criterion.data.score >= 7 ? 'success' : 
                            criterion.data.score >= 6 ? 'info' : 
                            'warning'
                          } size="sm">
                            Band {criterion.data.score}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{criterion.data.feedback}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5">
                      <h5 className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200 mb-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Strengths
                      </h5>
                      <ul className="space-y-2">
                        {aiEvaluation.strengths.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
                      <h5 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200 mb-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Areas for Improvement
                      </h5>
                      <ul className="space-y-2">
                        {aiEvaluation.areasForImprovement.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (!selectedResult?.section?.questions) return <p className="text-gray-500 italic">No questions found.</p>;
    let questionCounter = 0;
    const items: React.ReactNode[] = [];

    (selectedResult.section.questions as any[]).forEach((question) => {
      const studentAnswer = selectedResult.answers?.[question.id];
      if (question.type === 'MCQ_MULTIPLE' && Array.isArray(question.correctAnswer)) {
        (question.correctAnswer as string[]).forEach((ca, i) => {
          questionCounter++;
          const sa = Array.isArray(studentAnswer) ? studentAnswer[i] : undefined;
          const correct = isAnswerCorrect(sa, ca, 'MCQ_SINGLE');
          items.push(
            <div key={`${question.id}-${i}`} className={`p-4 rounded-xl border ${correct ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
              <div className="flex justify-between mb-2">
                <span className="font-medium text-gray-900">Q{questionCounter}. {question.questionText}</span>
                <Badge variant={correct ? 'success' : 'danger'} size="sm">{correct ? 'Correct' : 'Incorrect'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                 <div><p className="text-gray-500">Student:</p><p className="font-bold">{formatAnswer(sa, 'MCQ_SINGLE')}</p></div>
                 <div><p className="text-gray-500">Correct:</p><p className="font-bold text-gray-700">{formatAnswer(ca, 'MCQ_SINGLE')}</p></div>
              </div>
            </div>
          );
        });
      } else {
        questionCounter++;
        let ca = question.correctAnswer;
        if (['MATCHING','PLAN_MAP_LABELING','DIAGRAM_LABELING'].includes(question.type) && typeof ca === 'object' && ca !== null) { ca = ca[question.id]; }
        const correct = isAnswerCorrect(studentAnswer, ca, question.type);
        items.push(
          <div key={question.id} className={`p-4 rounded-xl border ${correct ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
            <div className="flex justify-between mb-2">
              <span className="font-medium text-gray-900">Q{questionCounter}. {question.questionText}</span>
              <Badge variant={correct ? 'success' : 'danger'} size="sm">{correct ? 'Correct' : 'Incorrect'}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm mt-3">
               <div><p className="text-gray-500">Student:</p><p className={`font-bold ${correct ? 'text-green-700' : 'text-red-700'}`}>{formatAnswer(studentAnswer, question.type)}</p></div>
               <div><p className="text-gray-500">Correct:</p><p className="font-bold text-gray-700">{formatAnswer(ca, question.type)}</p></div>
            </div>
          </div>
        );
      }
    });
    return <div className="space-y-4 pt-1">{items}</div>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Exam Results</h1>
        <p className="text-gray-500 mt-1">View student performance and scores</p>
      </div>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </span>
                  <input 
                    type="text"
                    placeholder="Search student name or username..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
             </div>
             <div className="w-48">
               <Select
                 options={[
                   { value: '', label: 'All Section Types' },
                   { value: 'READING', label: 'Reading' },
                   { value: 'LISTENING', label: 'Listening' },
                   { value: 'WRITING', label: 'Writing' },
                 ]}
                 value={typeFilter}
                 onChange={(e) => setTypeFilter(e.target.value)}
               />
             </div>
             <Button 
               variant="secondary" 
               onClick={() => {
                 setSearchTerm('');
                 setTypeFilter('');
               }}
             >
               Clear
             </Button>
          </div>
        </CardBody>
      </Card>

      {/* Grouped Results Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Completed Sections</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Test Date</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {groupedResults.map((group) => {
                  const student = group.student;

                  return (
                    <tr key={student.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                            {student.firstName?.[0] || student.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {student.firstName ? `${student.firstName} ${student.lastName || ''}` : student.username}
                            </p>
                            <p className="text-xs text-gray-500">@{student.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {Array.from(new Set(group.results.map(r => r.section?.type))).filter(Boolean).map(type => (
                            <Badge key={type} variant={sectionVariants[type || '']} size="sm">
                              {type}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                        {new Date(group.latestDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={() => {
                            setSelectedGroup(group);
                            setShowSelectedStudentModal(true);
                          }}
                        >
                          View Results
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {groupedResults.length === 0 && (
                   <tr>
                     <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                       {searchTerm || typeFilter ? 'No results match your filters' : 'No results found'}
                     </td>
                   </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Student Specific Results Modal - MATCHING REFERENCE IMAGE */}
      {showSelectedStudentModal && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-5xl max-h-[90vh] flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Exam Results</h2>
                <p className="text-sm text-gray-500 mt-1">View student performance and scores for {selectedGroup.student.firstName || selectedGroup.student.username}</p>
              </div>
              <button onClick={() => setShowSelectedStudentModal(false)} className="text-gray-400 hover:text-gray-500"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </CardHeader>
            <CardBody className="p-0 overflow-y-auto flex-1 min-h-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#F9FAFB] dark:bg-gray-800 border-b border-gray-100">
                    <tr>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Student</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Exam Section</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Score</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Band Score</th>
                      <th className="px-8 py-5 text-right text-[11px] font-bold text-gray-400 uppercase tracking-widest">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {selectedGroup.results.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).map((result) => (
                      <tr key={result.id} className="hover:bg-gray-50/50">
                        <td className="px-8 py-6">
                           <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-[#EBF1FF] flex items-center justify-center text-[#5569FF] font-bold text-sm">
                                {selectedGroup.student.firstName?.[0]?.toLowerCase() || selectedGroup.student.username[0].toLowerCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-semibold text-[15px] text-gray-900">{selectedGroup.student.firstName || selectedGroup.student.username}</span>
                                <span className="text-xs text-gray-400 font-medium tracking-tight">@{selectedGroup.student.username}</span>
                              </div>
                           </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="flex items-center gap-3">
                              <Badge key={result.id} variant={sectionVariants[result.section?.type || '']} size="sm">
                                {result.section?.type}
                              </Badge>
                              <span className="text-[15px] font-medium text-gray-600">{result.section?.title}</span>
                           </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="text-[15px] tabular-nums">
                              <span className="font-black text-gray-900">{result.score}</span>
                              <span className="text-gray-300 font-medium"> / {result.totalScore}</span>
                           </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="w-8 h-8 rounded-full bg-[#EBF1FF] flex items-center justify-center text-[#5569FF] font-black text-sm">
                              {result.bandScore}
                           </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                           <Button size="sm" variant="secondary" className="text-xs font-bold px-4" onClick={() => handleViewDetails(result.id)}>
                              View Full Breakdown
                           </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
            <div className="p-6 border-t border-gray-100 flex justify-end">
              <Button onClick={() => setShowSelectedStudentModal(false)}>Back to Summary</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Result Details Modal (Existing breakdown) */}
      <Modal isOpen={showModal} onClose={closeModal} title="Exam Result Breakdown" width="max-w-5xl">
        <div className="max-h-[80vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200">
          {detailLoading ? (
            <div className="py-12 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" /></div>
          ) : selectedResult ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                <div>
                    <h3 className="text-lg font-bold text-gray-900">{selectedResult.section?.title}</h3>
                    <p className="text-sm text-gray-500">Submitted on {new Date(selectedResult.submittedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Score</p>
                      <p className="text-xl font-black text-gray-900">{selectedResult.score} <span className="text-gray-300">/ {selectedResult.totalScore}</span></p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">IELTS Band</p>
                      <div className="h-9 w-9 mx-auto bg-indigo-600 rounded-full flex items-center justify-center text-white font-black text-sm">{selectedResult.bandScore}</div>
                    </div>
                </div>
              </div>
              {renderQuestions()}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Success Modal (Toast-like) */}
      <Modal isOpen={successModal.isOpen} onClose={() => setSuccessModal({ ...successModal, isOpen: false })} title="Grading Successful">
        <div className="text-center py-6">
           <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
           </div>
           <h3 className="text-2xl font-bold text-gray-900 mb-2">Evaluation Complete</h3>
           <p className="text-gray-500 mb-8">The AI analyzer has graded this submission.</p>
           <div className="bg-indigo-50 rounded-2xl p-6 border border-indigo-100 mb-8">
              <p className="text-sm text-indigo-600 font-bold uppercase tracking-widest mb-2">Assigned Band Score</p>
              <p className="text-6xl font-black text-indigo-900">{successModal.bandScore}</p>
           </div>
           <Button onClick={() => setSuccessModal({ ...successModal, isOpen: false })} className="w-full">Sweet! Close</Button>
        </div>
      </Modal>

      {/* Pagination (Simplified student-count based) */}
      {total > pageSize && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-6 py-4 rounded-xl border border-gray-100">
            <p className="text-sm text-gray-500 font-medium">Showing grouped entries for <span className="text-gray-900 font-bold">{groupedResults.length}</span> students</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= total}>Next</Button>
            </div>
        </div>
      )}
    </div>
  );
}
