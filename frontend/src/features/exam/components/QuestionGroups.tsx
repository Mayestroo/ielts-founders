'use client';

import { HighlightableText } from '@/components/exam/HighlightableText';
import {
  FillBlankQuestion,
  FlowChartGroup,
  MatchingGroup,
  MCQQuestion,
  ShortAnswerQuestion,
  SummaryGroup,
  TableGroup,
  TrueFalseQuestion,
} from '@/components/questions';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { Question } from '@/types';
import { AnswerValue } from '../types';
import { getEffectivePoints } from '../utils';

interface QuestionGroupsProps {
  questions: Question[];
  answers: Record<string, AnswerValue>;
  currentQuestionId: string;
  sectionType: string;
  onAnswerChange: (questionId: string, value: AnswerValue) => void;
  onQuestionFocus: (questionId: string) => void;
  showResults?: boolean;
}

export function QuestionGroups({
  questions,
  answers,
  currentQuestionId,
  sectionType,
  onAnswerChange,
  onQuestionFocus,
  showResults = false,
}: QuestionGroupsProps) {
  const renderQuestion = (question: Question, index: number) => {
    const value = answers[question.id] ?? '';
    const idMatch = question.id.match(/\d+/);
    const startNum = idMatch ? parseInt(idMatch[0]) : index + 1;
    const points = getEffectivePoints(question);
    const displayNumber = points > 1 ? `${startNum}-${startNum + points - 1}` : startNum;
    const isActive = currentQuestionId === question.id;

    return (
      <div key={question.id} id={`question-${question.id}`}>
        {(() => {
          let correctAnswer: string | string[] | undefined;
          
          if ('correctAnswer' in question) {
            correctAnswer = (question as { correctAnswer?: string | string[] }).correctAnswer;
          }

          switch (question.type) {
            case 'MCQ_SINGLE':
            case 'MCQ_MULTIPLE':
              return (
                <MCQQuestion
                  id={question.id}
                  questionText={question.questionText}
                  options={question.options}
                  isMultiple={question.type === 'MCQ_MULTIPLE'}
                  value={value as string | string[]}
                  onChange={(nextValue) => onAnswerChange(question.id, nextValue)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => onQuestionFocus(question.id)}
                  sectionType={sectionType}
                  showResult={showResults}
                  correctAnswer={correctAnswer}
                />
              );
            case 'TRUE_FALSE_NOT_GIVEN':
            case 'YES_NO_NOT_GIVEN':
              return (
                <TrueFalseQuestion
                  id={question.id}
                  questionText={question.questionText}
                  variant={question.type}
                  value={value as string}
                  onChange={(nextValue) => onAnswerChange(question.id, nextValue)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => onQuestionFocus(question.id)}
                  sectionType={sectionType}
                  showResult={showResults}
                  correctAnswer={correctAnswer as string}
                />
              );
            case 'FILL_BLANK':
            case 'SENTENCE_COMPLETION':
            case 'SUMMARY_COMPLETION':
            case 'NOTE_COMPLETION':
            case 'TABLE_COMPLETION':
            case 'FLOW_CHART_COMPLETION':
            case 'FORM_COMPLETION':
            case 'PLAN_MAP_LABELING':
            case 'MATCHING':
            case 'DIAGRAM_LABELING':
              return (
                <FillBlankQuestion
                  id={question.id}
                  questionText={question.questionText}
                  wordLimit={
                    'wordLimit' in question
                      ? (question as { wordLimit?: number }).wordLimit
                      : undefined
                  }
                  value={value as string}
                  onChange={(nextValue) => onAnswerChange(question.id, nextValue)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => onQuestionFocus(question.id)}
                  hideBullet={true}
                  sectionType={sectionType}
                  showResult={showResults}
                  correctAnswer={correctAnswer as string}
                />
              );
            case 'SHORT_ANSWER':
              return (
                <ShortAnswerQuestion
                  id={question.id}
                  questionText={question.questionText}
                  wordLimit={question.wordLimit}
                  value={value as string}
                  onChange={(nextValue) => onAnswerChange(question.id, nextValue)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => onQuestionFocus(question.id)}
                  sectionType={sectionType}
                  showResult={showResults}
                  correctAnswer={correctAnswer as string}
                />
              );
            default:
              return null;
          }
        })()}
      </div>
    );
  };

  const renderQuestionsWithGrouping = (groupQuestions: Question[]) => {
    const groups: { type: string; questions: Question[] }[] = [];
    let currentGroup: { type: string; questions: Question[] } | null = null;

    groupQuestions.forEach((question) => {
      const isMatching = [
        'MATCHING',
        'PLAN_MAP_LABELING',
        'DIAGRAM_LABELING',
      ].includes(question.type);
      const isFlowChart = question.type === 'FLOW_CHART_COMPLETION';
      const isTable = question.type === 'TABLE_COMPLETION';
      const isSummary = question.type === 'SUMMARY_COMPLETION';

      let groupType = `${question.questionRange}-${JSON.stringify(question.instruction)}`;

      if (isMatching || isFlowChart || isTable || isSummary) {
        const typePrefix = isMatching
          ? 'MATCHING'
          : isFlowChart
          ? 'FLOWCHART'
          : isTable
          ? 'TABLE'
          : 'SUMMARY';

        if (question.questionRange || question.instruction) {
          groupType = `${typePrefix}-${question.questionRange}-${JSON.stringify(
            question.instruction
          )}`;
        } else if (currentGroup && currentGroup.type.startsWith(`${typePrefix}-`)) {
          groupType = currentGroup.type;
        } else {
          groupType = `${typePrefix}-default`;
        }
      } else if (
        !question.instruction &&
        !question.questionRange &&
        currentGroup &&
        !currentGroup.type.startsWith('MATCHING-') &&
        !currentGroup.type.startsWith('FLOWCHART-') &&
        !currentGroup.type.startsWith('TABLE-') &&
        !currentGroup.type.startsWith('SUMMARY-')
      ) {
        groupType = currentGroup.type;
      }

      if (!currentGroup || currentGroup.type !== groupType) {
        currentGroup = {
          type: groupType,
          questions: [question],
        };
        groups.push(currentGroup);
      } else {
        currentGroup.questions.push(question);
      }
    });

    return groups.map((group, groupIdx) => {
      const firstQuestion = group.questions[0];
      const isMatching = group.type.startsWith('MATCHING-');
      const isFlowChart = group.type.startsWith('FLOWCHART-');
      const isTable = group.type.startsWith('TABLE-');
      const isSummary = group.type.startsWith('SUMMARY-');
      const showHeader = isMatching || isFlowChart || isTable || isSummary;

      return (
        <div key={`group-${groupIdx}`} className="space-y-6 pb-12">
          {(showHeader || firstQuestion.questionRange) && firstQuestion.questionRange && (
            <div className="mt-2 mb-2 pb-2">
              <h3 className="text-[17px] font-bold text-[#30343C]">
                Questions {firstQuestion.questionRange}
              </h3>
            </div>
          )}
          {(showHeader || firstQuestion.instruction) && firstQuestion.instruction && (
            <div className="mb-3">
              {sectionType === 'LISTENING' || sectionType === 'READING' ? (
                <HighlightableText
                  content={firstQuestion.instruction}
                  initialHighlights={[]}
                  onHighlightsChange={() => {}}
                  inline={true}
                />
              ) : (
                <p
                  className="text-[#30343C] text-[15px] leading-relaxed font-normal"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(
                      firstQuestion.instruction.replace(
                        /\*\*(.*?)\*\*/g,
                        '<strong>$1</strong>',
                      ),
                    ),
                  }}
                />
              )}
            </div>
          )}
          {'title' in firstQuestion && (firstQuestion as { title?: string }).title && (
            <div className="mb-4 mt-2">
              <h4 className="text-lg font-bold text-center text-[#30343C] uppercase tracking-wide">
                {(firstQuestion as { title?: string }).title}
              </h4>
            </div>
          )}

          {isMatching && (
            <MatchingGroup
              questions={group.questions}
              options={
                'options' in firstQuestion
                  ? (firstQuestion as { options?: { id: string; text: string }[] })
                      .options || []
                  : []
              }
              answers={Object.fromEntries(
                Object.entries(answers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
              )}
              onChange={(questionId, nextValue) =>
                onAnswerChange(questionId, nextValue)
              }
              currentQuestionId={currentQuestionId}
              onQuestionClick={onQuestionFocus}
              questionsLabel={
                'questionsLabel' in firstQuestion
                  ? (firstQuestion as { questionsLabel?: string }).questionsLabel
                  : undefined
              }
              optionsLabel={
                'optionsLabel' in firstQuestion
                  ? (firstQuestion as { optionsLabel?: string }).optionsLabel
                  : undefined
              }
              imageUrl={firstQuestion.imageUrl}
              sectionType={sectionType}
              showResults={showResults}
            />
          )}

          {isSummary && (
            <SummaryGroup
              questions={group.questions}
              answers={answers}
              onChange={onAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={onQuestionFocus}
              sectionType={sectionType}
              showResults={showResults}
            />
          )}

          {isFlowChart && (
            <FlowChartGroup
              questions={group.questions}
              answers={answers}
              onChange={onAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={onQuestionFocus}
              sectionType={sectionType}
              showResults={showResults}
            />
          )}

          {isTable && (
            <TableGroup
              questions={group.questions}
              answers={answers}
              onChange={onAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={onQuestionFocus}
              sectionType={sectionType}
              showResults={showResults}
            />
          )}

          {!isMatching && !isSummary && !isFlowChart && !isTable && (
            <div className="space-y-4">
              {group.questions.map((question) => {
                const indexInFiltered = groupQuestions.findIndex(
                  (filteredQuestion) => filteredQuestion.id === question.id
                );
                return renderQuestion(question, indexInFiltered);
              })}
            </div>
          )}
        </div>
      );
    });
  };

  return <>{renderQuestionsWithGrouping(questions)}</>;
}
