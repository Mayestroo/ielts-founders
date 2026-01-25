'use client';

import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { generateWritingDOCX } from '@/lib/generateDOCX';
import { generateResultPDF } from '@/lib/generatePDF';
import { ExamResult } from '@/types';
import React, { useEffect, useState } from 'react';

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
  const [pdfLoading, setPdfLoading] = useState<string | null>(null); // studentId being processed
  const [docxLoading, setDocxLoading] = useState(false);

  const handleDownloadReport = async (studentId: string, studentName: string) => {
    setPdfLoading(studentId);
    try {
      const studentResults = await api.getStudentReportData(studentId);
      
      if (studentResults.length === 0) {
        alert('No results found for this student.');
        return;
      }

      // Find results for each section
      const listeningResult = studentResults.find(r => r.section?.type === 'LISTENING');
      const readingResult = studentResults.find(r => r.section?.type === 'READING');
      const writingResult = studentResults.find(r => r.section?.type === 'WRITING');

      // Get student info from first result
      const student = studentResults[0].student!;
      const testDate = new Date(studentResults[0].submittedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      await generateResultPDF({
        student,
        results: {
          listening: listeningResult,
          reading: readingResult,
          writing: writingResult,
        },
        testDate,
      });
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      alert('Failed to generate PDF report.');
    } finally {
      setPdfLoading(null);
    }
  };

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
    setAiEvaluation(null);
    setAiError(null);
    try {
      const result = await api.getResult(id);
      setSelectedResult(result);
      // Check if AI evaluation already exists (feedback field or answers fallback)
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
  };

  const handleEvaluateWithAI = async () => {
    if (!selectedResult) return;
    
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await api.evaluateWriting(selectedResult.id);
      setAiEvaluation(response.aiEvaluation);
    } catch (err) {
      console.error('AI evaluation failed:', err);
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
       return studentAnswer.length === correctAnswer.length && 
              studentAnswer.every((a: any) => correctAnswer.includes(a));
    }

    return JSON.stringify(studentAnswer) === JSON.stringify(correctAnswer) || 
           String(studentAnswer).toLowerCase().trim() === String(correctAnswer).toLowerCase().trim();
  };

  const formatAnswer = (answer: any, type: string) => {
    if (answer === undefined || answer === null || answer === '-') return '-';
    
    if (type === 'MCQ_MULTIPLE' && Array.isArray(answer)) {
      return answer.map((a: any) => String(a).toUpperCase()).join(', ');
    }
    
    if (type === 'MCQ_SINGLE' || type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN') {
       return String(answer).toUpperCase();
    }
    
    if (typeof answer === 'object') {
       return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    
    return String(answer);
  };

  const renderQuestions = () => {
    // Special handling for Writing sections
    if (selectedResult?.section?.type === 'WRITING') {
      const answers = selectedResult.answers || {};
      const writingTasks = [];
      
      if (answers['w1']) writingTasks.push({ id: 'Task 1', response: answers['w1'] });
      if (answers['w2']) writingTasks.push({ id: 'Task 2', response: answers['w2'] });
      if (answers['writing'] && writingTasks.length === 0) {
        writingTasks.push({ id: 'Writing Task', response: answers['writing'] });
      }

      return (
        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="font-medium text-blue-900 dark:text-blue-100">Writing tasks require careful evaluation</p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">Student responses for each task are shown below. Band scores are automatically provided by AI but should be verified.</p>
              </div>
              <Button 
                onClick={handleDownloadWritingDOCX}
                disabled={docxLoading}
                className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                size="sm"
              >
                {docxLoading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download as DOCX
                  </>
                )}
              </Button>
            </div>
          </div>

          {writingTasks.map((task) => {
            const wordCount = task.response.trim().split(/\s+/).filter((w: string) => w).length;
            return (
              <div key={task.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-3 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-white">Student Response - {task.id}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{wordCount} words</span>
                </div>
                <div className="p-6">
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-relaxed font-sans">{task.response}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {writingTasks.length === 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
              <p className="text-gray-500 italic text-center">No responses submitted.</p>
            </div>
          )}

        

          {/* AI Evaluation Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Evaluation</h3>
              
            {(!aiEvaluation || aiEvaluation.bandScore === 0) && selectedResult?.section?.type === 'WRITING' && (
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
                  // Single Task View (Existing)
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
        const correctAnswers = question.correctAnswer as string[];
        const studentAnswers = Array.isArray(studentAnswer) ? studentAnswer : [];
        
        // Find matched, wrong, and missed answers
        const matched = studentAnswers.filter(a => correctAnswers.includes(a));
        const wrong = studentAnswers.filter(a => !correctAnswers.includes(a));
        const missed = correctAnswers.filter(a => !studentAnswers.includes(a));

        // Generate a row for each correct answer slot (effectively 1 point each)
        correctAnswers.forEach((_, i) => {
          questionCounter++;
          
          let displayStudentVal = '-';
          let displayCorrectVal = '';
          let isRowCorrect = false;

          if (i < matched.length) {
            // Student got this one right
            displayStudentVal = matched[i];
            displayCorrectVal = matched[i]; // or displayCorrectVal = correctAnswers[i] ?
            // Actually, keep it simple: Show what they matched
            isRowCorrect = true;
          } else {
            // Student got this wrong
            // Show one of their wrong answers if available
            const wrongIdx = i - matched.length;
            if (wrongIdx < wrong.length) {
               displayStudentVal = wrong[wrongIdx];
            }
            // Show one of the missed correct answers
            displayCorrectVal = missed[wrongIdx];
            isRowCorrect = false;
          }

          items.push(
            <div key={`${question.id}-${i}`} className={`p-4 rounded-lg border ${isRowCorrect ? 'border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800' : 'border-red-200 bg-red-50/50 dark:bg-red-900/10 dark:border-red-800'}`}>
              <div className="flex justify-between items-start mb-2">
                <span className="font-medium text-gray-900 dark:text-white">Q{questionCounter}. {question.questionText}</span>
                <Badge variant={isRowCorrect ? 'success' : 'danger'} size="sm">
                  {isRowCorrect ? 'Correct' : 'Incorrect'}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
                <div>
                  <p className="text-gray-500 mb-1">Student Answer:</p>
                  <p className={`font-medium ${isRowCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                    {formatAnswer(displayStudentVal, 'MCQ_SINGLE')}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">Correct Answer:</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {formatAnswer(displayCorrectVal, 'MCQ_SINGLE')}
                  </p>
                </div>
              </div>
            </div>
          );
        });

      } else {
        // Standard single question
        questionCounter++;
        
        let correctAnswer = question.correctAnswer;
        // Handle MATCHING/Labeling where correctAnswer is an object {qid: "A"}
        if (
          (question.type === 'MATCHING' ||
           question.type === 'PLAN_MAP_LABELING' ||
           question.type === 'DIAGRAM_LABELING') &&
          correctAnswer &&
          typeof correctAnswer === 'object' &&
          !Array.isArray(correctAnswer)
        ) {
          correctAnswer = (correctAnswer as Record<string, string>)[question.id];
        }

        const isCorrect = isAnswerCorrect(studentAnswer, correctAnswer, question.type);

        items.push(
          <div key={question.id} className={`p-4 rounded-lg border ${isCorrect ? 'border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800' : 'border-red-200 bg-red-50/50 dark:bg-red-900/10 dark:border-red-800'}`}>
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium text-gray-900 dark:text-white">Q{questionCounter}. {question.questionText}</span>
              <Badge variant={isCorrect ? 'success' : 'danger'} size="sm">
                {isCorrect ? 'Correct' : 'Incorrect'}
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
              <div>
                <p className="text-gray-500 mb-1">Student Answer:</p>
                <p className={`font-medium ${isCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {formatAnswer(studentAnswer, question.type)}
                </p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Correct Answer:</p>
                <p className="font-medium text-gray-700 dark:text-gray-300">
                   {formatAnswer(correctAnswer, question.type)}
                </p>
              </div>
            </div>
          </div>
        );
      }
    });

    return <div className="space-y-4">{items}</div>;
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

      {/* Results Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Exam Section</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Band Score</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Submitted At</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {results.map((result) => (
                  <tr key={result.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                          {result.student?.firstName?.[0] || result.student?.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {result.student?.firstName ? `${result.student.firstName} ${result.student.lastName || ''}` : result.student?.username}
                          </p>
                          <p className="text-xs text-gray-500">@{result.student?.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          result.section?.type === 'READING' ? 'info' :
                          result.section?.type === 'LISTENING' ? 'warning' : 'success'
                        } size="sm">
                          {result.section?.type}
                        </Badge>
                        <span className="text-gray-900 dark:text-white">{result.section?.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-900 dark:text-white">
                      <span className="font-semibold">{result.score}</span>
                      <span className="text-gray-500 text-sm"> / {result.totalScore}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                        {result.bandScore}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {new Date(result.submittedAt).toLocaleDateString()} {new Date(result.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => handleViewDetails(result.id)}>
                          View
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No results found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700">
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
              disabled={page * pageSize >= total}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                <span className="font-medium">{total}</span> results
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
                {[...Array(Math.ceil(total / pageSize))].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0 ${
                      page === i + 1
                        ? 'z-10 bg-indigo-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                        : 'text-gray-900 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * pageSize >= total}
                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
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

      {/* Details Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col">
            <CardHeader className="flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10 border-b dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Exam Result Details</h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </CardHeader>
            <CardBody className="overflow-y-auto p-6">
              {detailLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500"></div>
                </div>
              ) : selectedResult ? (
                <div className="space-y-8">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl">
                      <p className="text-sm text-gray-500">Total Score</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {selectedResult.score} <span className="text-sm font-normal text-gray-400">/ {selectedResult.totalScore}</span>
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl">
                      <p className="text-sm text-gray-500">Band Score</p>
                      <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{selectedResult.bandScore}</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl">
                      <p className="text-sm text-gray-500">Student</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        {selectedResult.student?.firstName} {selectedResult.student?.lastName}
                      </p>
                      <p className="text-sm text-gray-500">@{selectedResult.student?.username}</p>
                    </div>
                  </div>

                  {/* Questions Breakdown */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Question Breakdown</h3>
                    {renderQuestions()}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  Failed to load details.
                </div>
              )}
            </CardBody>
            <div className="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl flex justify-end">
              <Button onClick={closeModal}>Close</Button>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}
