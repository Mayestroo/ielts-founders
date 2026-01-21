import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, Role } from '@prisma/client';
import { AiService, WritingEvaluation } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { CreateExamSectionDto } from './dto/create-exam-section.dto';
import { SaveHighlightsDto, SubmitAnswersDto } from './dto/submit-answers.dto';
import { UpdateExamSectionDto } from './dto/update-exam-section.dto';

interface QuestionItem {
  id: string;
  type: string;
  correctAnswer?: string | string[] | Record<string, string>;
  points?: number;
  questionText?: string;
  instruction?: string;
}

// Re-export WritingEvaluation for controller usage
export type { WritingEvaluation };

// Type for section-level AI evaluation result
export interface SectionEvaluationResult {
  bandScore: number;
  tasks: Record<string, WritingEvaluation>;
}

@Injectable()
export class ExamsService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  // ========== EXAM SECTIONS ==========

  async createSection(
    createSectionDto: CreateExamSectionDto,
    teacherId: string,
    centerId: string,
  ) {
    return this.prisma.examSection.create({
      data: {
        ...createSectionDto,
        questions: createSectionDto.questions as Prisma.InputJsonValue,
        passages: createSectionDto.passages as Prisma.InputJsonValue,
        teacherId,
        centerId,
      },
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async findAllSections(
    userRole: Role,
    centerId: string | null,
    teacherId?: string,
  ) {
    let where: Prisma.ExamSectionWhereInput = {};

    if (userRole === Role.TEACHER && centerId) {
      // Teachers see all sections in their center (not just their own)
      where = { centerId };
    } else if (userRole === Role.CENTER_ADMIN && centerId) {
      where = { centerId };
    }
    // SUPER_ADMIN sees all

    return this.prisma.examSection.findMany({
      where,
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        center: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSectionById(id: string) {
    const section = await this.prisma.examSection.findUnique({
      where: { id },
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        center: { select: { id: true, name: true } },
      },
    });

    if (!section) {
      throw new NotFoundException('Exam section not found');
    }

    return section;
  }

  async deleteSection(id: string, userId: string, userRole: Role) {
    const section = await this.findSectionById(id);

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only delete your own sections');
    }

    await this.prisma.examSection.delete({ where: { id } });
    return { message: 'Section deleted successfully' };
  }

  async updateSection(
    id: string,
    updateSectionDto: UpdateExamSectionDto,
    userId: string,
    userRole: Role,
  ) {
    const section = await this.findSectionById(id);

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only update your own sections');
    }

    return this.prisma.examSection.update({
      where: { id },
      data: {
        ...updateSectionDto,
        questions: updateSectionDto.questions as Prisma.InputJsonValue,
        passages: updateSectionDto.passages as Prisma.InputJsonValue,
      },
    });
  }

  // ========== ASSIGNMENTS ==========

  async createAssignment(
    createAssignmentDto: CreateAssignmentDto,
    assignerId: string,
    centerId: string,
  ) {
    const { studentId, sectionId } = createAssignmentDto;

    // Validate student exists and belongs to the same center
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || student.role !== Role.STUDENT) {
      throw new BadRequestException('Invalid student');
    }
    if (student.centerId !== centerId) {
      throw new ForbiddenException('Student must belong to your center');
    }

    // Validate section exists
    const section = await this.prisma.examSection.findUnique({
      where: { id: sectionId },
    });
    if (!section) {
      throw new BadRequestException('Section not found');
    }

    // Check if already assigned
    const existingAssignment = await this.prisma.examAssignment.findUnique({
      where: { studentId_sectionId: { studentId, sectionId } },
    });
    if (existingAssignment) {
      throw new BadRequestException('Section already assigned to this student');
    }

    return this.prisma.examAssignment.create({
      data: { studentId, sectionId },
      include: {
        section: true,
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async findAllAssignments(
    requesterRole: Role,
    requesterCenterId: string | null,
    skip?: number,
    take?: number,
  ) {
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot list all assignments');
    }

    let where: Prisma.ExamAssignmentWhereInput = {};
    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      where = {
        student: { centerId: requesterCenterId },
      };
    }

    const [assignments, total] = await Promise.all([
      this.prisma.examAssignment.findMany({
        where,
        include: {
          section: {
            select: {
              id: true,
              title: true,
              type: true,
              description: true,
              duration: true,
            },
          },
          student: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      }),
      this.prisma.examAssignment.count({ where }),
    ]);

    return { assignments, total };
  }

  async getStudentAssignments(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    // Students can only view their own assignments
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    return this.prisma.examAssignment.findMany({
      where: { studentId },
      include: {
        section: {
          select: {
            id: true,
            title: true,
            type: true,
            description: true,
            duration: true,
            audioUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async startExam(assignmentId: string, studentId: string) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      include: { section: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('This assignment is not assigned to you');
    }

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      throw new BadRequestException('This exam has already been submitted');
    }

    // If already in progress, return existing data
    if (
      assignment.status === AssignmentStatus.IN_PROGRESS &&
      assignment.startTime
    ) {
      return {
        ...assignment,
        remainingTime: this.calculateRemainingTime(
          assignment.startTime,
          assignment.section.duration,
        ),
      };
    }

    // Start the exam
    const startTime = new Date();
    const endTime = new Date(
      startTime.getTime() + assignment.section.duration * 60 * 1000,
    );

    const updatedAssignment = await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.IN_PROGRESS,
        startTime,
        endTime,
      },
      include: {
        section: true,
      },
    });

    return {
      ...updatedAssignment,
      remainingTime: assignment.section.duration * 60, // in seconds
    };
  }

  private calculateRemainingTime(
    startTime: Date,
    durationMinutes: number,
  ): number {
    const now = new Date();
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const remaining = Math.max(
      0,
      Math.floor((endTime.getTime() - now.getTime()) / 1000),
    );
    return remaining;
  }

  async submitAnswers(
    assignmentId: string,
    submitDto: SubmitAnswersDto,
    studentId: string,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      include: { section: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('This assignment is not assigned to you');
    }

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      throw new BadRequestException('This exam has already been submitted');
    }

    // Validate timer
    if (assignment.endTime && new Date() > assignment.endTime) {
      // Auto-submit with existing answers if timer expired
    }

    let score = 0;
    let totalScore = 0;
    let bandScore = 0;
    let aiEvaluation: SectionEvaluationResult | WritingEvaluation | null = null;

    if (assignment.section.type === 'WRITING') {
      // Handle Writing Section - Auto AI Evaluation
      const answers = submitDto.answers as Record<string, string>;
      const tasksToEvaluate: {
        id: string;
        description: string;
        response: string;
      }[] = [];

      // Check for Task 1 and Task 2 keys (w1, w2) or generic 'writing' key
      const questions = assignment.section.questions as QuestionItem[] | null;
      if (answers['w1'] || answers['task1']) {
        const response = answers['w1'] || answers['task1'];
        tasksToEvaluate.push({
          id: 'Task 1',
          description:
            (questions?.[0]?.questionText as string) || 'IELTS Writing Task 1',
          response: response,
        });
      }
      if (answers['w2'] || answers['task2']) {
        const response = answers['w2'] || answers['task2'];
        tasksToEvaluate.push({
          id: 'Task 2',
          description:
            (questions?.[1]?.questionText as string) || 'IELTS Writing Task 2',
          response: response,
        });
      }
      if (answers['writing'] && !answers['w1'] && !answers['w2']) {
        // Fallback for single writing task
        tasksToEvaluate.push({
          id: 'Writing Task',
          description: assignment.section.description || 'IELTS Writing Task',
          response: answers['writing'],
        });
      }

      if (tasksToEvaluate.length > 0) {
        const evaluationResult =
          await this.aiService.evaluateWritingSection(tasksToEvaluate);
        bandScore = evaluationResult.bandScore;
        aiEvaluation = evaluationResult;
        // Writing raw score is often not used, but we can set it to band score * 10 or similar for internal consistency,
        // or just rely on bandScore. Let's set score = bandScore for simplicity in tracking.
        score = bandScore;
        totalScore = 9; // Max band score
      }
    } else {
      // Handle Reading / Listening
      const calculation = this.calculateScore(
        assignment.section.questions as unknown as QuestionItem[],
        submitDto.answers,
      );
      score = calculation.score;
      totalScore = calculation.totalScore;

      bandScore = this.calculateBandScore(
        score,
        totalScore,
        assignment.section.type,
      );
    }

    // Update assignment
    const updatedAssignment = await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.SUBMITTED,
        answers: aiEvaluation
          ? ({
              ...submitDto.answers,
              _aiEvaluation: aiEvaluation,
            } as unknown as Prisma.InputJsonValue)
          : submitDto.answers,
        score,
      },
    });

    // Create result
    await this.prisma.examResult.create({
      data: {
        studentId,
        sectionId: assignment.sectionId,
        score,
        totalScore,
        bandScore,
        answers: aiEvaluation
          ? ({
              ...submitDto.answers,
              _aiEvaluation: aiEvaluation,
            } as unknown as Prisma.InputJsonValue)
          : submitDto.answers,
        feedback: aiEvaluation as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    return {
      message: 'Exam submitted successfully',
      assignmentId: updatedAssignment.id,
      status: updatedAssignment.status,
    };
  }

  private calculateScore(
    questions: QuestionItem[],
    answers: Record<string, unknown>,
  ): { score: number; totalScore: number } {
    let score = 0;
    let totalScore = 0;

    for (const question of questions) {
      let points = question.points || 1;
      
      // Fallback for MCQ_MULTIPLE if points is missing/1
      if (question.type === 'MCQ_MULTIPLE' && points === 1 && question.instruction) {
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
      const correctAnswer = question.correctAnswer;

      if (
        question.type === 'MCQ_MULTIPLE' &&
        Array.isArray(studentAnswer) &&
        Array.isArray(correctAnswer)
      ) {
        // Partial credit for MCQ Multiple
        // Each correct selection counts as 1 point
        const correctCount = studentAnswer.filter((a: string) =>
          correctAnswer.includes(a),
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

    return { score, totalScore };
  }

  private isAnswerCorrect(
    studentAnswer: string | string[] | undefined,
    correctAnswer: string | string[] | Record<string, string> | undefined,
    questionType: string,
    questionText?: string,
    instruction?: string,
  ): boolean {
    if (!studentAnswer || !correctAnswer) return false;

    // Handle different question types
    switch (questionType) {
      case 'MCQ_SINGLE':
      case 'TRUE_FALSE_NOT_GIVEN':
      case 'YES_NO_NOT_GIVEN':
        return studentAnswer === correctAnswer;

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
        // For single MATCHING questions (not grouped), compare directly
        if (
          typeof studentAnswer === 'string' &&
          typeof correctAnswer === 'string'
        ) {
          return studentAnswer === correctAnswer;
        }
        // For grouped MATCHING questions, compare objects
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
    studentAnswer: any,
    correctAnswer: any,
    questionText?: string,
    instruction?: string,
  ): boolean {
    const studentStr = String(studentAnswer).trim();
    const correctStr = String(correctAnswer).trim();

    // Number/Word equivalence check (if instruction allows numbers)
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

      // Check if student entered number but correct is word (or vice versa)
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

    // Check if BLANK starts a sentence (capitalization matters)
    const startsWithBlank =
      questionText &&
      (/^[•\-\s]*\[BLANK\]/i.test(questionText) ||
        /\.\s*\[BLANK\]/i.test(questionText) ||
        /\n\s*\[BLANK\]/i.test(questionText));

    if (startsWithBlank) {
      // At sentence start, first letter must be capitalized
      const correctFirstChar = correctStr[0];
      const isCorrectLowercase =
        correctFirstChar && correctFirstChar === correctFirstChar.toLowerCase();

      if (isCorrectLowercase) {
        // Correct answer is lowercase, but at sentence start must be capitalized
        const expectedCapitalized =
          correctStr[0].toUpperCase() + correctStr.substring(1);
        return studentStr === expectedCapitalized;
      } else {
        // Correct answer already has proper capitalization, match exactly
        return studentStr === correctStr;
      }
    }

    // Mid-sentence: accept lowercase/uppercase but reject Title Case
    const studentLower = studentStr.toLowerCase();
    const correctLower = correctStr.toLowerCase();

    // Exact match (any case)
    if (studentStr === correctStr) {
      return true;
    }

    // All lowercase match
    if (studentStr === studentLower && correctLower === studentLower) {
      return true;
    }

    // All uppercase match (MUSEUM = museum)
    const studentUpper = studentStr.toUpperCase();
    if (studentStr === studentUpper && correctLower === studentLower) {
      return true;
    }

    // Reject Title Case when correct answer is lowercase (Museum != museum)
    return false;
  }

  private calculateBandScore(
    score: number,
    totalScore: number,
    sectionType: string,
  ): number {
    // If total questions is not 40, we scale the score to 40
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
      // ACADEMIC READING
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

  async saveHighlights(
    assignmentId: string,
    dto: SaveHighlightsDto,
    studentId: string,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        highlights: dto.highlights,
      },
    });
  }

  // ========== RESULTS ==========

  async findAllResults(
    requesterRole: Role,
    requesterCenterId: string | null,
    skip?: number,
    take?: number,
  ) {
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot list all results');
    }

    let where: Prisma.ExamResultWhereInput = {};
    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      where = {
        student: { centerId: requesterCenterId },
      };
    }

    const [results, total] = await Promise.all([
      this.prisma.examResult.findMany({
        where,
        include: {
          section: {
            select: { id: true, title: true, type: true },
          },
          student: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      }),
      this.prisma.examResult.count({ where }),
    ]);

    return { results, total };
  }

  async getResultById(
    id: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const result = await this.prisma.examResult.findUnique({
      where: { id },
      include: {
        section: true,
        student: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            centerId: true,
          },
        },
      },
    });

    if (!result) {
      throw new NotFoundException('Result not found');
    }

    if (requesterRole === Role.STUDENT && result.studentId !== requesterId) {
      throw new ForbiddenException('You can only view your own results');
    }

    if (requesterRole === Role.TEACHER || requesterRole === Role.CENTER_ADMIN) {
      if (result.student.centerId !== requesterCenterId) {
        throw new ForbiddenException(
          'You can only view results from your center',
        );
      }
    }

    return result;
  }

  async getStudentResults(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    // Only TEACHER and CENTER_ADMIN can view results
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot view results');
    }

    // Validate access
    if (requesterRole === Role.TEACHER || requesterRole === Role.CENTER_ADMIN) {
      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
      });
      if (!student || student.centerId !== requesterCenterId) {
        throw new ForbiddenException(
          'You can only view results for students in your center',
        );
      }
    }

    return this.prisma.examResult.findMany({
      where: { studentId },
      include: {
        section: {
          select: { id: true, title: true, type: true },
        },
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getAssignmentDetails(
    assignmentId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        section: true,
        student: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            centerId: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Check permissions
    if (
      requesterRole === Role.STUDENT &&
      assignment.studentId !== requesterId
    ) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    return assignment;
  }

  // ========== AI EVALUATION ==========

  async evaluateWritingWithAI(
    resultId: string,
    // These params are passed from controller for future authorization checks
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _requesterId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _requesterRole: Role,
  ) {
    // 1. Fetch the ExamResult first (since resultId is passed)
    const examResult = await this.prisma.examResult.findUnique({
      where: { id: resultId },
      include: {
        section: true,
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });

    if (!examResult) {
      throw new NotFoundException('Result not found');
    }

    // Check if it's a writing section
    if (examResult.section?.type !== 'WRITING') {
      throw new BadRequestException(
        'AI evaluation is only available for writing sections',
      );
    }

    // 2. Fetch the corresponding ExamAssignment to get the answers
    const assignment = await this.prisma.examAssignment.findUnique({
      where: {
        studentId_sectionId: {
          studentId: examResult.studentId,
          sectionId: examResult.sectionId,
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Associated assignment not found');
    }

    // Get existing evaluation if present
    const answers = (assignment.answers ?? {}) as Record<string, unknown>;
    const w1 = answers?.['w1'];
    const w2 = answers?.['w2'];
    const writing = answers?.['writing'];
    const writingResponse =
      typeof (w1 || w2 || writing) === 'string'
        ? ((w1 || w2 || writing) as string)
        : '';

    // Check if already evaluated to prevent redundant calls
    const feedbackObj = examResult.feedback as Record<string, unknown> | null;
    if (
      feedbackObj &&
      typeof feedbackObj === 'object' &&
      'bandScore' in feedbackObj
    ) {
      return {
        ...examResult,
        aiEvaluation: examResult.feedback,
      };
    }

    const existingEvaluation = answers?._aiEvaluation as
      | WritingEvaluation
      | undefined;
    if (existingEvaluation) {
      // If stored in answers but not in feedback field, sync it
      await this.prisma.examResult.update({
        where: { id: resultId },
        data: {
          feedback: existingEvaluation as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        ...examResult,
        aiEvaluation: existingEvaluation,
      };
    }

    let evaluation: WritingEvaluation | SectionEvaluationResult;

    const tasksToEvaluate: {
      id: string;
      description: string;
      response: string;
    }[] = [];

    // Check for Task 1 and Task 2 keys (w1, w2)
    if (answers['w1'] || answers['task1']) {
      tasksToEvaluate.push({
        id: 'Task 1',
        description: 'Task 1',
        response: String(answers['w1'] || answers['task1']),
      });
    }
    if (answers['w2'] || answers['task2']) {
      tasksToEvaluate.push({
        id: 'Task 2',
        description: 'Task 2',
        response: String(answers['w2'] || answers['task2']),
      });
    }

    if (tasksToEvaluate.length > 0) {
      // Multi-task evaluation
      evaluation = await this.aiService.evaluateWritingSection(tasksToEvaluate);
    } else if (writingResponse) {
      // Fallback for single writing task often used in simple setups
      evaluation = await this.aiService.evaluateWritingTask(
        examResult.section.description || 'IELTS Writing Task',
        writingResponse,
      );
    } else {
      throw new BadRequestException('No writing response found to evaluate');
    }

    // 3. Update ExamResult with band score and feedback
    await this.prisma.examResult.update({
      where: { id: resultId },
      data: {
        bandScore: evaluation.bandScore,
        feedback: evaluation as unknown as Prisma.InputJsonValue,
      },
    });

    // 4. Update ExamAssignment with detailed AI evaluation in answers
    await this.prisma.examAssignment.update({
      where: { id: assignment.id },
      data: {
        answers: {
          ...answers,
          _aiEvaluation: evaluation,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      ...examResult,
      bandScore: evaluation.bandScore,
      aiEvaluation: evaluation,
    };
  }

  // ========== REASSIGN ==========

  async reassignAssignment(
    assignmentId: string,
    // These params are passed from controller for future authorization checks
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _requesterId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _requesterRole: Role,
  ) {
    // 1. Fetch the assignment
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Note: We preserve the previous result in the database as a historical record.
    // The ExamResult table keeps all attempts, allowing teachers to see past performance.

    // 2. Reset the assignment for a new attempt
    return this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.ASSIGNED,
        answers: {},
        score: 0,
        startTime: null,
        endTime: null,
      },
    });
  }
}
