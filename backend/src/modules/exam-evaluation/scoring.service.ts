import { Injectable } from '@nestjs/common';

interface QuestionItem {
  id: string;
  type: string;
  correctAnswer?: string | string[] | Record<string, string>;
  correctAnswers?: string[]; // Support plural field for MCQ_MULTIPLE
  points?: number;
  questionText?: string;
  instruction?: string;
}

interface ScoreResult {
  score: number;
  totalScore: number;
  bandScore: number;
}

@Injectable()
export class ScoringService {
  calculateScore(
    questions: QuestionItem[],
    answers: Record<string, unknown>,
    sectionType: string,
  ): ScoreResult {
    let score = 0;
    let totalScore = 0;

    for (const question of questions) {
      let points = question.points || 1;

      if (
        question.type === 'MCQ_MULTIPLE' &&
        points === 1 &&
        question.instruction
      ) {
        const instr = question.instruction.toUpperCase();
        if (instr.includes('TWO')) points = 2;
        else if (instr.includes('THREE')) points = 3;
        else if (instr.includes('FOUR')) points = 4;
        else if (instr.includes('FIVE')) points = 5;
      }

      totalScore += points;

      const studentAnswer = answers[question.id] as
        | string
        | string[]
        | undefined;
      // Check both singular and plural fields for correct answer
      let correctAnswer = question.correctAnswer ?? question.correctAnswers;

      if (
        (question.type === 'MATCHING' ||
          question.type === 'PLAN_MAP_LABELING' ||
          question.type === 'DIAGRAM_LABELING') &&
        correctAnswer &&
        typeof correctAnswer === 'object' &&
        !Array.isArray(correctAnswer)
      ) {
        correctAnswer = correctAnswer[question.id];
      }

      // Normalize string correctAnswer to array for MCQ_MULTIPLE
      if (
        question.type === 'MCQ_MULTIPLE' &&
        typeof correctAnswer === 'string'
      ) {
        correctAnswer = [correctAnswer];
      }

      if (
        question.type === 'MCQ_MULTIPLE' &&
        Array.isArray(studentAnswer) &&
        Array.isArray(correctAnswer)
      ) {
        const normalizedCorrect = correctAnswer.map((a: string) =>
          String(a).toLowerCase().trim(),
        );
        const correctCount = studentAnswer.filter((a: string) =>
          normalizedCorrect.includes(String(a).toLowerCase().trim()),
        ).length;
        score += Math.min(correctCount, points);
      } else if (
        this.isAnswerCorrect(
          studentAnswer,
          correctAnswer,
          question.type,
          question.questionText,
          question.instruction,
        )
      ) {
        score += points;
      }
    }

    const bandScore = this.calculateBandScore(score, totalScore, sectionType);

    return { score, totalScore, bandScore };
  }

  private isAnswerCorrect(
    studentAnswer: string | string[] | undefined,
    correctAnswer: string | string[] | Record<string, string> | undefined,
    questionType: string,
    questionText?: string,
    instruction?: string,
  ): boolean {
    if (!studentAnswer || !correctAnswer) return false;

    switch (questionType) {
      case 'MCQ_SINGLE':
      case 'TRUE_FALSE_NOT_GIVEN':
      case 'YES_NO_NOT_GIVEN':
        const s = Array.isArray(studentAnswer)
          ? studentAnswer[0]
          : studentAnswer;
        const c = Array.isArray(correctAnswer)
          ? correctAnswer[0]
          : correctAnswer;
        return (
          String(s).toLowerCase().trim() === String(c).toLowerCase().trim()
        );

      case 'MCQ_MULTIPLE':
        if (!Array.isArray(studentAnswer) || !Array.isArray(correctAnswer))
          return false;
        return (
          studentAnswer.length === correctAnswer.length &&
          studentAnswer.every((a: string) => correctAnswer.includes(a))
        );

      case 'FILL_BLANK':
      case 'SHORT_ANSWER':
      case 'SENTENCE_COMPLETION':
      case 'SUMMARY_COMPLETION':
      case 'NOTE_COMPLETION':
      case 'TABLE_COMPLETION':
      case 'FLOW_CHART_COMPLETION':
      case 'FORM_COMPLETION':
        return this.compareTextAnswer(
          studentAnswer,
          correctAnswer,
          questionText,
          instruction,
        );

      case 'MATCHING':
      case 'PLAN_MAP_LABELING':
      case 'DIAGRAM_LABELING':
        if (
          typeof studentAnswer === 'string' &&
          typeof correctAnswer === 'string'
        ) {
          return studentAnswer === correctAnswer;
        }
        if (
          typeof studentAnswer !== 'object' ||
          typeof correctAnswer !== 'object'
        )
          return false;
        return JSON.stringify(studentAnswer) === JSON.stringify(correctAnswer);

      default:
        return studentAnswer === correctAnswer;
    }
  }

  private compareTextAnswer(
    studentAnswer: unknown,
    correctAnswer: unknown,
    questionText?: string,
    instruction?: string,
  ): boolean {
    const studentStr = String(studentAnswer).trim();
    const correctStr = String(correctAnswer).trim();

    const normalizePercentage = (text: string): string => {
      return text.replace(/(\d+)%/g, '$1 percent');
    };

    const studentNormalized = normalizePercentage(studentStr);
    const correctNormalized = normalizePercentage(correctStr);

    if (studentNormalized.toLowerCase() === correctNormalized.toLowerCase()) {
      return true;
    }

    if (
      instruction &&
      /word\s+(and\/or|or|and)\s+(a\s+)?number/i.test(instruction)
    ) {
      const wordToNumber: Record<string, string> = {
        one: '1',
        two: '2',
        three: '3',
        four: '4',
        five: '5',
        six: '6',
        seven: '7',
        eight: '8',
        nine: '9',
        ten: '10',
      };

      const studentLower = studentStr.toLowerCase();
      const correctLower = correctStr.toLowerCase();

      if (
        wordToNumber[studentLower] === correctLower ||
        wordToNumber[correctLower] === studentLower
      ) {
        return true;
      }
      if (studentLower === correctLower) {
        return true;
      }
    }

    const startsWithBlank =
      questionText &&
      (/^[•\-\s]*\[BLANK\]/i.test(questionText) ||
        /\.\s*\[BLANK\]/i.test(questionText) ||
        /\n\s*\[BLANK\]/i.test(questionText));

    if (startsWithBlank) {
      const correctFirstChar = correctStr[0];
      const isCorrectLowercase =
        correctFirstChar && correctFirstChar === correctFirstChar.toLowerCase();

      if (isCorrectLowercase) {
        const expectedCapitalized =
          correctStr[0].toUpperCase() + correctStr.substring(1);
        return studentStr === expectedCapitalized;
      } else {
        return studentStr === correctStr;
      }
    }

    const studentLower = studentStr.toLowerCase();
    const correctLower = correctStr.toLowerCase();

    if (studentStr === correctStr) {
      return true;
    }

    if (studentStr === studentLower && correctLower === studentLower) {
      return true;
    }

    const studentUpper = studentStr.toUpperCase();
    if (studentStr === studentUpper && correctLower === studentLower) {
      return true;
    }

    return false;
  }

  calculateBandScore(
    score: number,
    totalScore: number,
    sectionType: string,
  ): number {
    const rawScore =
      totalScore === 40 ? score : Math.round((score / totalScore) * 40);

    if (sectionType === 'LISTENING') {
      if (rawScore >= 39) return 9.0;
      if (rawScore >= 37) return 8.5;
      if (rawScore >= 35) return 8.0;
      if (rawScore >= 32) return 7.5;
      if (rawScore >= 30) return 7.0;
      if (rawScore >= 26) return 6.5;
      if (rawScore >= 23) return 6.0;
      if (rawScore >= 18) return 5.5;
      if (rawScore >= 16) return 5.0;
      if (rawScore >= 13) return 4.5;
      if (rawScore >= 11) return 4.0;
      if (rawScore >= 8) return 3.5;
      if (rawScore >= 6) return 3.0;
      if (rawScore >= 4) return 2.5;
      if (rawScore >= 2) return 2.0;
      if (rawScore >= 1) return 1.0;
      return 0.0;
    } else {
      if (rawScore >= 39) return 9.0;
      if (rawScore >= 37) return 8.5;
      if (rawScore >= 35) return 8.0;
      if (rawScore >= 33) return 7.5;
      if (rawScore >= 30) return 7.0;
      if (rawScore >= 27) return 6.5;
      if (rawScore >= 23) return 6.0;
      if (rawScore >= 19) return 5.5;
      if (rawScore >= 15) return 5.0;
      if (rawScore >= 13) return 4.5;
      if (rawScore >= 10) return 4.0;
      if (rawScore >= 8) return 3.5;
      if (rawScore >= 6) return 3.0;
      if (rawScore >= 4) return 2.5;
      if (rawScore >= 2) return 2.0;
      if (rawScore >= 1) return 1.0;
      return 0.0;
    }
  }
}
