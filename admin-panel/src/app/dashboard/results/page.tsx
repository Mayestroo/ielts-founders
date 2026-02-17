'use client';

import { Badge, Button, Card, CardBody, CardHeader, Modal, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { generateWritingDOCX } from '@/lib/generateDOCX';
import { ADMIN_QUERY_TIMINGS } from '@/lib/query/config';
import { adminQueryKeys } from '@/lib/query/keys';
import { ExamResult, Question, User } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';

interface AiCriterion {
  score: number;
  feedback: string;
}

interface AiEvaluation {
  bandScore: number;
  taskAchievement: AiCriterion;
  coherenceAndCohesion: AiCriterion;
  lexicalResource: AiCriterion;
  grammaticalRangeAndAccuracy: AiCriterion;
  overallFeedback: string;
  strengths: string[];
  areasForImprovement: string[];
}

interface MultiTaskAiEvaluation {
  bandScore: number;
  tasks: Record<string, AiEvaluation>;
}

type AiEvaluationPayload = AiEvaluation | MultiTaskAiEvaluation;
type LegacyQuestion = Question & { correctAnswers?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasMultiTaskBreakdown = (
  evaluation: AiEvaluationPayload,
): evaluation is MultiTaskAiEvaluation =>
  isRecord(evaluation) && isRecord((evaluation as MultiTaskAiEvaluation).tasks);

const coerceAiEvaluation = (value: unknown): AiEvaluationPayload | null => {
  if (!isRecord(value) || typeof value.bandScore !== 'number') {
    return null;
  }

  if (isRecord(value.tasks)) {
    return value as unknown as MultiTaskAiEvaluation;
  }

  if (typeof value.overallFeedback === 'string') {
    return value as unknown as AiEvaluation;
  }

  return null;
};

export default function ResultsPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [selectedResult, setSelectedResult] = useState<ExamResult | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [aiEvaluation, setAiEvaluation] = useState<AiEvaluationPayload | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStatus, setAiStatus] = useState('');
  const [successModal, setSuccessModal] = useState<{ isOpen: boolean; bandScore: number }>({
    isOpen: false,
    bandScore: 0,
  });
  const queryClient = useQueryClient();
  const { error: showError } = useToast();

  const resultsQuery = useQuery({
    queryKey: adminQueryKeys.resultsList({ skip: 0, take: 1000 }),
    queryFn: ({ signal }) => api.getResults(0, 1000, { signal }),
    staleTime: ADMIN_QUERY_TIMINGS.list.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.list.gcTime,
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) => {
      const payload = query.state.data as { results?: ExamResult[] } | undefined;
      const pendingWriting = payload?.results?.some((result) => {
        const status = result.writingSubmission?.status;
        return status === 'QUEUED' || status === 'PROCESSING';
      });

      return pendingWriting ? 5000 : false;
    },
  });

  const selectedResultQuery = useQuery({
    queryKey: selectedResultId
      ? adminQueryKeys.result(selectedResultId)
      : ['admin', 'results', 'selected-empty'],
    queryFn: ({ signal }) => api.getResult(selectedResultId!, { signal }),
    enabled: showModal && Boolean(selectedResultId),
    staleTime: ADMIN_QUERY_TIMINGS.list.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.list.gcTime,
  });

  const results = useMemo(
    () => resultsQuery.data?.results ?? [],
    [resultsQuery.data],
  );
  const isLoading = resultsQuery.isLoading && !resultsQuery.data;
  const detailLoading = selectedResultQuery.isLoading || selectedResultQuery.isFetching;

  useEffect(() => {
    if (!selectedResultQuery.data) {
      return;
    }

    setSelectedResult(selectedResultQuery.data);
    const existingEval =
      selectedResultQuery.data.feedback || selectedResultQuery.data.answers?._aiEvaluation;
    const normalizedEval = coerceAiEvaluation(existingEval);
    if (normalizedEval) {
      setAiEvaluation(normalizedEval);
    }
  }, [selectedResultQuery.data]);

  useEffect(() => {
    if (!selectedResultQuery.error || !showModal) {
      return;
    }

    showError('Failed to load result details');
  }, [selectedResultQuery.error, showModal, showError]);

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

  // Client-side pagination logic
  const paginatedGroups = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return groupedResults.slice(startIndex, startIndex + pageSize);
  }, [groupedResults, page, pageSize]);

  const totalGroups = useMemo(() => {
    return new Set(results.map((result) => result.studentId)).size;
  }, [results]);

  const hasFilters = Boolean(searchTerm.trim() || typeFilter);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, typeFilter]);

  useEffect(() => {
    if (!resultsQuery.error) {
      return;
    }

    showError('Failed to load results');
  }, [resultsQuery.error, showError]);

  const handleViewDetails = async (id: string) => {
    setSelectedResultId(id);
    setShowModal(true);
    setShowSelectedStudentModal(false);
    setSelectedResult(null);
    setAiEvaluation(null);
    setAiError(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedResultId(null);
    setSelectedResult(null);
    setAiEvaluation(null);
    setAiError(null);
    if (selectedGroup) {
      setShowSelectedStudentModal(true);
    }
  };

  const handleEvaluateWithAI = async (resultToEvaluate?: ExamResult) => {
    const target = resultToEvaluate ?? selectedResult;
    if (!target) return;
    
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
      const response = await api.evaluateWriting(target.id);
      clearInterval(progressInterval);
      setAiProgress(100);
      setAiStatus('Evaluation complete!');
      
      const newEval = response.aiEvaluation || response.feedback;
      const normalizedEval = coerceAiEvaluation(newEval);
      if (normalizedEval) {
        setAiEvaluation(normalizedEval);
      }
      
      const updatedResult = {
        ...target,
        score: response.score ?? response.bandScore,
        totalScore: response.totalScore ?? 9,
        bandScore: response.bandScore,
        feedback: normalizedEval ?? newEval,
        writingSubmission: response.writingSubmission || target.writingSubmission
      };

      if (selectedResult && selectedResult.id === target.id) {
        setSelectedResult(updatedResult);
      }

      queryClient.setQueryData(adminQueryKeys.result(target.id), updatedResult);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'results'] });
      setSuccessModal({ isOpen: true, bandScore: response.bandScore });
    } catch (err) {
      clearInterval(progressInterval);
      setAiError(err instanceof Error ? err.message : 'Failed to evaluate with AI');
      showError('AI evaluation failed');
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
      showError('Failed to generate DOCX file');
    } finally {
      setDocxLoading(false);
    }
  };

  const isAnswerCorrect = (studentAnswer: unknown, correctAnswer: unknown, type: string) => {
    if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '-') return false;
    
    // MCQ_MULTIPLE set-based comparison
    if (type === 'MCQ_MULTIPLE' && Array.isArray(studentAnswer) && Array.isArray(correctAnswer)) {
      if (studentAnswer.length !== correctAnswer.length) return false;
      const sSet = new Set(studentAnswer.map((answer) => String(answer).toLowerCase().trim()));
      const cSet = new Set(correctAnswer.map((answer) => String(answer).toLowerCase().trim()));
      if (sSet.size !== cSet.size) return false;
      for (const answer of sSet) if (!cSet.has(answer)) return false;
      return true;
    }

    // Single answer comparison
    const s = String(studentAnswer).toLowerCase().trim();
    const c = String(correctAnswer).toLowerCase().trim();
    return s === c;
  };

  const formatAnswer = (answer: unknown, type: string, isCorrectAnswer = false) => {
    if (answer === undefined || answer === null || answer === '-' || answer === '') {
      return isCorrectAnswer ? '(Not configured)' : '-';
    }
    if (type === 'MCQ_MULTIPLE' && Array.isArray(answer)) return answer.map((item) => String(item).toUpperCase()).join(', ');
    if (type === 'MCQ_SINGLE' || type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN') return String(answer).toUpperCase();
    if (isRecord(answer)) return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
    return String(answer);
  };

  const sectionVariants: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
    READING: 'info',
    LISTENING: 'warning',
    WRITING: 'success',
  };

  const getWritingStatusBadge = (result: ExamResult) => {
    const submission = result.writingSubmission;
    if (!submission) return null;

    switch (submission.status) {
      case 'QUEUED':
        return <Badge variant="info" size="sm" className="animate-pulse">Queued</Badge>;
      case 'PROCESSING':
        return <Badge variant="warning" size="sm" className="animate-pulse">Evaluating...</Badge>;
      case 'COMPLETED':
        return <Badge variant="success" size="sm">Graded</Badge>;
      case 'FAILED':
        return <Badge variant="danger" size="sm">Failed</Badge>;
      case 'MANUAL_REVIEW':
        return <Badge variant="info" size="sm">Manual Review</Badge>;
      default:
        return null;
    }
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
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-200"
            >
              {docxLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-slate-500 border-t-transparent mr-2" />
              ) : (
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              )}
              {docxLoading ? 'Generating...' : 'Download DOCX'}
            </Button>
          </div>

          {writingTasks.map(task => (
            <div key={task.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <span className="text-sm font-semibold uppercase tracking-wider text-slate-500">{task.id}</span>
                <span className="text-xs text-slate-400">{task.response.split(/\s+/).filter(Boolean).length} words</span>
              </div>
              <div className="p-6">
                <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed text-[17px]">{task.response}</p>
              </div>
            </div>
          ))}

          {/* AI Evaluation Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">AI Evaluation</h3>
              
            {selectedResult?.section?.type === 'WRITING' && (
                <div className="flex gap-2">
                  {selectedResult.writingSubmission?.status === 'FAILED' && (
                    <Button 
                      onClick={() => handleEvaluateWithAI(selectedResult)} 
                      disabled={aiLoading}
                      variant="secondary"
                      size="sm"
                    >
                      Retry Evaluation
                    </Button>
                  )}
                  <Button 
                    onClick={() => handleEvaluateWithAI(selectedResult)} 
                    disabled={aiLoading}
                    variant="primary"
                    size="sm"
                  >
                    {aiLoading ? (
                      <>
                        <div className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        {aiEvaluation ? 'Re-evaluate' : 'Evaluate with AI'}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {aiLoading && (
              <div className="mb-6 space-y-3 animate-in fade-in duration-300">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-600 dark:text-slate-300 font-medium flex items-center">
                    <div className="h-4 w-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mr-2" />
                    {aiStatus}
                  </span>
                  <span className="text-slate-500 font-bold">{aiProgress}%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-slate-900 h-full transition-all duration-500 ease-out" 
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
                {hasMultiTaskBreakdown(aiEvaluation) ? (
                  <div className="space-y-8">
                     {/* Overall Band Score Card */}
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900 dark:text-slate-100">Overall Band Score</h4>
                          <p className="text-slate-600 dark:text-slate-300 text-sm">Weighted Average (Task 2 counts double)</p>
                        </div>
                        <div className="h-16 w-16 rounded-full bg-slate-900 flex items-center justify-center text-white text-2xl font-bold shadow-sm">
                          {aiEvaluation.bandScore}
                        </div>
                      </div>
                    </div>

                    {/* Task Tabs/Sections */}
                    {Object.entries(aiEvaluation.tasks).map(([taskId, evalData]) => (
                      <div key={taskId} className="border-t border-slate-200 dark:border-slate-700 pt-6">
                         <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-4">{taskId} Evaluation</h4>
                         
                         {/* Individual Task Feedback */}
                         <div className="space-y-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                <p className="text-slate-700 dark:text-slate-300 italic border-l-4 border-slate-300 pl-4 py-1">
                                  &quot;{evalData.overallFeedback}&quot;
                                </p>
                             </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                               {[
                                 { label: 'Task Achievement', data: evalData.taskAchievement },
                                 { label: 'Coherence & Cohesion', data: evalData.coherenceAndCohesion },
                                 { label: 'Lexical Resource', data: evalData.lexicalResource },
                                 { label: 'Grammar', data: evalData.grammaticalRangeAndAccuracy },
                               ].map((criterion) => (
                                 <div key={criterion.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-center mb-2">
                                      <h5 className="font-semibold text-slate-900 dark:text-white">{criterion.label}</h5>
                                      <Badge variant={
                                        criterion.data.score >= 7 ? 'success' : 
                                        criterion.data.score >= 6 ? 'info' : 
                                        'warning'
                                      } size="sm">
                                        Band {criterion.data.score}
                                      </Badge>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">{criterion.data.feedback}</p>
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
                  <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-bold text-slate-900 dark:text-slate-100">Estimated Band Score</h4>
                        <p className="text-slate-600 dark:text-slate-300 text-sm">Based on official IELTS criteria</p>
                      </div>
                      <div className="h-16 w-16 rounded-full bg-slate-900 flex items-center justify-center text-white text-2xl font-bold shadow-sm">
                        {aiEvaluation.bandScore}
                      </div>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 italic border-l-4 border-slate-300 pl-4 py-1">
                      &quot;{aiEvaluation.overallFeedback}&quot;
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: 'Task Achievement', data: aiEvaluation.taskAchievement },
                      { label: 'Coherence & Cohesion', data: aiEvaluation.coherenceAndCohesion },
                      { label: 'Lexical Resource', data: aiEvaluation.lexicalResource },
                      { label: 'Grammar', data: aiEvaluation.grammaticalRangeAndAccuracy },
                    ].map((criterion) => (
                      <div key={criterion.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-center mb-2">
                          <h5 className="font-semibold text-slate-900 dark:text-white">{criterion.label}</h5>
                          <Badge variant={
                            criterion.data.score >= 7 ? 'success' : 
                            criterion.data.score >= 6 ? 'info' : 
                            'warning'
                          } size="sm">
                            Band {criterion.data.score}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{criterion.data.feedback}</p>
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

    (selectedResult.section.questions as LegacyQuestion[]).forEach((question) => {
      const rawQuestion = question as {
        id: string;
        type: string;
        questionText: string;
        points?: number;
        correctAnswer?: unknown;
        correctAnswers?: unknown;
      };

      const studentAnswer = selectedResult.answers?.[rawQuestion.id];
      const points = rawQuestion.points || 1;
      
      // Support both correctAnswer (singular) and correctAnswers (plural) field names
      const correctAnswer =
        rawQuestion.correctAnswer ?? rawQuestion.correctAnswers;
      
      // Only split if we have multiple points AND multiple correct answers to map them to
      const shouldSplit = points > 1 && (
        (rawQuestion.type === 'MCQ_MULTIPLE' && Array.isArray(correctAnswer)) ||
        (['MATCHING','PLAN_MAP_LABELING','DIAGRAM_LABELING'].includes(rawQuestion.type) && typeof correctAnswer === 'object' && !Array.isArray(correctAnswer))
      );

      if (shouldSplit) {
        const studentAnswers = Array.isArray(studentAnswer)
          ? studentAnswer
          : isRecord(studentAnswer)
            ? Object.values(studentAnswer)
            : [];
        const correctAnswersArr = Array.isArray(correctAnswer)
          ? correctAnswer
          : isRecord(correctAnswer)
            ? Object.values(correctAnswer)
            : [];
        
        correctAnswersArr.forEach((ca, i) => {
          questionCounter++;
          // For split questions, we mark as correct if the student's OVERALL set for this question contains this correct answer
          // or if it's a direct index match for objects (Matching)
          let isPartCorrect = false;
          let displayStudentAnswer: string;
          
          if (Array.isArray(correctAnswer)) {
              isPartCorrect = studentAnswers.some(sa => String(sa).toLowerCase().trim() === String(ca).toLowerCase().trim());
             // Just show the student's selections
              displayStudentAnswer = studentAnswers.length > 0 
               ? studentAnswers.map((answer) => String(answer).toUpperCase()).join(', ')
                : '-';
          } else if (isRecord(correctAnswer)) {
             // For Matching, check by specific sub-key if possible, or fallback to index
              const subId = Object.keys(correctAnswer)[i];
              const answerByQuestion = selectedResult.answers?.[rawQuestion.id];
              const subAnswer = isRecord(answerByQuestion)
                ? answerByQuestion[subId]
                : undefined;
              isPartCorrect = String(subAnswer).toLowerCase().trim() === String(ca).toLowerCase().trim();
              displayStudentAnswer = formatAnswer(subAnswer, 'MCQ_SINGLE');
          } else {
              displayStudentAnswer = '-';
          }
          
          items.push(
            <div key={`${rawQuestion.id}-${i}`} className={`p-4 rounded-xl border ${isPartCorrect ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
              <div className="flex justify-between mb-2">
                <span className="font-medium text-gray-900">Q{questionCounter}. {rawQuestion.questionText}</span>
                <Badge variant={isPartCorrect ? 'success' : 'danger'} size="sm">{isPartCorrect ? 'Correct' : 'Incorrect'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                 <div>
                    <p className="text-gray-500">Student:</p>
                    <p className={`font-bold ${isPartCorrect ? 'text-green-700' : 'text-red-700'}`}>
                      {displayStudentAnswer}
                    </p>
                 </div>
                 <div>
                    <p className="text-gray-500">Answer:</p>
                    <p className={`font-bold text-gray-700`}>
                      {Array.isArray(correctAnswer) ? String(ca).toUpperCase() : formatAnswer(ca, 'MCQ_SINGLE', true)}
                    </p>
                 </div>
              </div>
            </div>
          );
        });

      } else {
        questionCounter++;
        const ca =
          ['MATCHING', 'PLAN_MAP_LABELING', 'DIAGRAM_LABELING'].includes(rawQuestion.type) &&
          isRecord(correctAnswer)
            ? correctAnswer[rawQuestion.id] || correctAnswer
            : correctAnswer;
        
        const correct = isAnswerCorrect(studentAnswer, ca, rawQuestion.type);
        const label = points > 1 ? `Q${questionCounter}-${questionCounter + points - 1}` : `Q${questionCounter}`;
        if (points > 1) questionCounter += (points - 1);

        // Format display values - handle MCQ_MULTIPLE arrays properly
        const displayStudentAnswer = formatAnswer(studentAnswer, rawQuestion.type);
        const displayCorrectAnswer = formatAnswer(ca, rawQuestion.type, true);

        items.push(
          <div key={rawQuestion.id} className={`p-4 rounded-xl border ${correct ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
            <div className="flex justify-between mb-2">
              <span className="font-medium text-gray-900">{label}. {rawQuestion.questionText}</span>
              <Badge variant={correct ? 'success' : 'danger'} size="sm">{correct ? 'Correct' : 'Incorrect'}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm mt-3">
               <div><p className="text-gray-500">Student:</p><p className={`font-bold ${correct ? 'text-green-700' : 'text-red-700'}`}>{displayStudentAnswer}</p></div>
               <div><p className="text-gray-500">Correct:</p><p className="font-bold text-gray-700">{displayCorrectAnswer}</p></div>
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Exam Results</h1>
        <p className="text-slate-500 mt-1">
          View student performance and scores
          <span className="ml-2 text-xs text-slate-400">{groupedResults.length} of {totalGroups} students</span>
        </p>
      </div>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </span>
                  <input 
                    type="text"
                    placeholder="Search student name or username..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-slate-300 outline-none transition-all"
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
              <>
                <Button 
                  variant="secondary" 
                  onClick={() => {
                    setSearchTerm('');
                    setTypeFilter('');
                  }}
                  disabled={!hasFilters}
                >
                  Clear
                </Button>
              </>
           </div>
        </CardBody>
      </Card>

      {/* Grouped Results Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed Sections</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Test Date</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {paginatedGroups.map((group) => {
                  const student = group.student;

                  return (
                    <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white font-semibold text-xs">
                            {student.firstName?.[0] || student.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {student.firstName ? `${student.firstName} ${student.lastName || ''}` : student.username}
                            </p>
                            <p className="text-xs text-slate-500">@{student.username}</p>
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
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-sm">
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
                {paginatedGroups.length === 0 && (
                   <tr>
                     <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
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
          <Card className="w-full max-w-5xl max-h-[90vh] h-auto flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Exam Results</h2>
                <p className="text-sm text-slate-500 mt-1">View student performance and scores for {selectedGroup.student.firstName || selectedGroup.student.username}</p>
              </div>
              <button onClick={() => setShowSelectedStudentModal(false)} className="text-slate-400 hover:text-slate-500"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </CardHeader>
            <CardBody className="p-0 overflow-y-auto shrink min-h-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200">
                    <tr>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Student</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Exam Section</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Score</th>
                      <th className="px-8 py-5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Band Score</th>
                      <th className="px-8 py-5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-widest">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {selectedGroup.results.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).map((result) => (
                      <tr key={result.id} className="hover:bg-slate-50/50">
                        <td className="px-8 py-6">
                           <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-sm">
                                {selectedGroup.student.firstName?.[0]?.toLowerCase() || selectedGroup.student.username[0].toLowerCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-semibold text-[15px] text-slate-900 dark:text-white">{selectedGroup.student.firstName || selectedGroup.student.username}</span>
                                <span className="text-xs text-slate-400 font-medium tracking-tight">@{selectedGroup.student.username}</span>
                              </div>
                           </div>
                        </td>
                         <td className="px-8 py-6">
                            <div className="flex items-center gap-3">
                               <Badge key={result.id} variant={sectionVariants[result.section?.type || '']} size="sm">
                                 {result.section?.type}
                               </Badge>
                               <span className="text-[15px] font-medium text-slate-600">{result.section?.title}</span>
                               {result.section?.type === 'WRITING' && getWritingStatusBadge(result)}
                            </div>
                         </td>
                         <td className="px-8 py-6">
                            <div className="text-[15px] tabular-nums font-medium">
                               {result.section?.type === 'WRITING' && (!result.bandScore && result.writingSubmission?.status !== 'COMPLETED') ? (
                                 <span className="text-slate-400 italic">Pending AI</span>
                               ) : (
                                 <div className="flex items-center gap-1">
                                   <span className="font-black text-slate-900">{result.score}</span>
                                   <span className="text-slate-300">/ {result.totalScore}</span>
                                 </div>
                               )}
                            </div>
                         </td>
                         <td className="px-8 py-6">
                            <div className="flex items-center gap-2">
                               {result.section?.type === 'WRITING' && (!result.bandScore && result.writingSubmission?.status !== 'COMPLETED') ? (
                                  <Badge variant="default" size="sm">Pending</Badge>
                               ) : (
                                  <Badge variant={result.bandScore && result.bandScore >= 7 ? 'success' : result.bandScore && result.bandScore >= 6 ? 'info' : 'warning'} size="sm" className="font-bold">
                                    Band {result.bandScore ?? '-'}
                                  </Badge>
                               )}
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
            <div className="p-6 border-t border-slate-200 flex justify-end">
              <Button onClick={() => setShowSelectedStudentModal(false)}>Back to Summary</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Result Details Modal (Existing breakdown) */}
      <Modal isOpen={showModal} onClose={closeModal} title="Exam Result Breakdown" width="max-w-5xl">
        <div className="max-h-[80vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
          {detailLoading ? (
            <div className="py-12 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-slate-400" /></div>
          ) : selectedResult ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                    <h3 className="text-lg font-bold text-slate-900">{selectedResult.section?.title}</h3>
                    <p className="text-sm text-slate-500">Submitted on {new Date(selectedResult.submittedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Score</p>
                      <p className="text-xl font-black text-slate-900">{selectedResult.score} <span className="text-slate-300">/ {selectedResult.totalScore}</span></p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">IELTS Band</p>
                      <div className="h-9 w-9 mx-auto bg-slate-900 rounded-full flex items-center justify-center text-white font-black text-sm">{selectedResult.bandScore}</div>
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
           <h3 className="text-2xl font-bold text-slate-900 mb-2">Evaluation Complete</h3>
           <p className="text-slate-500 mb-8">The AI analyzer has graded this submission.</p>
           <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 mb-8">
              <p className="text-sm text-slate-600 font-bold uppercase tracking-widest mb-2">Assigned Band Score</p>
              <p className="text-6xl font-black text-slate-900">{successModal.bandScore}</p>
           </div>
           <Button onClick={() => setSuccessModal({ ...successModal, isOpen: false })} className="w-full">Sweet! Close</Button>
        </div>
      </Modal>

      {/* Pagination (Simplified student-count based) */}
      {/* Pagination */}
      {groupedResults.length > pageSize && (
        <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-1 justify-between sm:hidden">
            <Button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              onClick={() => setPage(p => p + 1)}
               disabled={page * pageSize >= groupedResults.length}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                 Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, groupedResults.length)}</span> of{' '}
                 <span className="font-medium">{groupedResults.length}</span> groups
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
                {[...Array(Math.ceil(groupedResults.length / pageSize))].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-slate-200 focus:z-20 focus:outline-offset-0 ${
                      page === i + 1
                        ? 'z-10 bg-slate-900 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
                        : 'text-slate-900 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => p + 1)}
                   disabled={page * pageSize >= groupedResults.length}
                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
