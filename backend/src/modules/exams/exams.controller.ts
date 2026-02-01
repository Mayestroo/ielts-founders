import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ExamSectionService } from '../exam-content/exam-section.service';
import { ResultService } from '../exam-evaluation/result.service';
import { WritingEvaluationService } from '../exam-evaluation/writing-evaluation.service';
import {
    AssignmentService,
    AssignmentWithSection,
} from '../exam-runtime/assignment.service';
import { ExamSessionService } from '../exam-runtime/exam-session.service';
import { SubmissionService } from '../exam-runtime/submission.service';
import {
    CreateAssignmentDto,
    CreateExamSectionDto,
    CreateFullMockDto,
    HeartbeatDto,
    ReconnectDto,
    SaveHighlightsDto,
    SubmitAnswersDto,
    SyncAnswersDto,
    UpdateExamSectionDto,
} from './dto';

interface AuthenticatedUser {
  id: string;
  role: Role;
  centerId: string | null;
}

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExamsController {
  constructor(
    private examSectionService: ExamSectionService,
    private assignmentService: AssignmentService,
    private submissionService: SubmissionService,
    private examSessionService: ExamSessionService,
    private resultService: ResultService,
    private writingEvaluationService: WritingEvaluationService,
  ) {}

  // ========== EXAM SECTIONS ==========

  @Post('exam-sections')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  async createSection(
    @Body() createSectionDto: CreateExamSectionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const centerId = createSectionDto.centerId || req.user.centerId;

    if (!centerId) {
      throw new BadRequestException(
        'centerId is required. Please specify a center.',
      );
    }

    return this.examSectionService.create(
      createSectionDto,
      req.user.id,
      centerId,
    );
  }

  @Get('exam-sections')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  findAllSections(@Request() req: AuthenticatedRequest) {
    return this.examSectionService.findAll(
      req.user.role,
      req.user.centerId,
      req.user.id,
    );
  }

  @Get('exam-sections/:id')
  findSectionById(@Param('id') id: string) {
    return this.examSectionService.findById(id);
  }

  @Put('exam-sections/:id')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  updateSection(
    @Param('id') id: string,
    @Body() updateSectionDto: UpdateExamSectionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examSectionService.update(
      id,
      updateSectionDto,
      req.user.id,
      req.user.role,
    );
  }

  @Delete('exam-sections/:id')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  deleteSection(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.examSectionService.delete(id, req.user.id, req.user.role);
  }

  // ========== ASSIGNMENTS ==========

  @Post('assignments')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN)
  createAssignment(
    @Body() createAssignmentDto: CreateAssignmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.create(
      createAssignmentDto,
      req.user.id,
      req.user.centerId!,
    );
  }

  @Post('assignments/full-mock')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN)
  createFullMockAssignment(
    @Body() createFullMockDto: CreateFullMockDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.createFullMock(
      createFullMockDto,
      req.user.id,
      req.user.centerId!,
    );
  }

  @Get('assignments')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  findAllAssignments(
    @Request() req: AuthenticatedRequest,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
  ) {
    return this.assignmentService.findAll(
      req.user.role,
      req.user.centerId,
      skip,
      take,
    );
  }

  @Get('assignments/student/:studentId')
  getStudentAssignments(
    @Param('studentId') studentId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.getStudentAssignments(
      studentId,
      req.user.id,
      req.user.role,
    );
  }

  @Get('assignments/my')
  getMyAssignments(@Request() req: AuthenticatedRequest) {
    return this.assignmentService.getStudentAssignments(
      req.user.id,
      req.user.id,
      req.user.role,
    );
  }

  @Get('assignments/:id')
  getAssignmentDetails(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<AssignmentWithSection> {
    return this.assignmentService.findById(id, req.user.id, req.user.role);
  }

  @Post('assignments/:id/start')
  @Roles(Role.STUDENT)
  startExam(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.assignmentService.startExam(id, req.user.id);
  }

  @Post('assignments/:id/submit')
  @Roles(Role.STUDENT)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  submitAnswers(
    @Param('id') id: string,
    @Body() submitDto: SubmitAnswersDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.submissionService.submitAnswers(id, submitDto, req.user.id);
  }

  @Post('assignments/:id/highlight')
  @Roles(Role.STUDENT)
  saveHighlights(
    @Param('id') id: string,
    @Body() highlightsDto: SaveHighlightsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.saveHighlights(
      id,
      highlightsDto.highlights,
      req.user.id,
    );
  }

  // ========== SESSION MANAGEMENT (Offline Resilience) ==========

  @Post('assignments/:id/sync')
  @Roles(Role.STUDENT)
  syncAnswers(
    @Param('id') id: string,
    @Body() body: SyncAnswersDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examSessionService.syncAnswers(
      id,
      req.user.id,
      body.answers,
      body.highlights || [],
      body.syncVersion || 0,
    );
  }

  @Post('assignments/:id/heartbeat')
  @Roles(Role.STUDENT)
  heartbeat(
    @Param('id') id: string,
    @Body() body: HeartbeatDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examSessionService.heartbeat(id, req.user.id, body.tabId);
  }

  @Post('assignments/:id/reconnect')
  @Roles(Role.STUDENT)
  reconnectExam(
    @Param('id') id: string,
    @Body() body: ReconnectDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examSessionService.reconnect(
      id,
      req.user.id,
      body.clientAnswers || {},
      body.tabId,
    );
  }

  // ========== WRITING SUBMISSION STATUS ==========

  @Get('writing-submissions/:id/status')
  getWritingSubmissionStatus(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writingEvaluationService.getWritingSubmissionStatus(
      id,
      req.user.id,
      req.user.role,
    );
  }

  // ========== RESULTS ==========

  @Get('results')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  findAllResults(
    @Request() req: AuthenticatedRequest,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
  ) {
    return this.resultService.findAll(
      req.user.role,
      req.user.centerId,
      skip,
      take,
    );
  }

  @Get('results/student/:studentId')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  getStudentResults(
    @Param('studentId') studentId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.resultService.getStudentResults(
      studentId,
      req.user.id,
      req.user.role,
      req.user.centerId,
    );
  }

  @Get('results/:id')
  getResultById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.resultService.findById(
      id,
      req.user.id,
      req.user.role,
      req.user.centerId,
    );
  }

  @Post('results/:id/evaluate-writing')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  evaluateWriting(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.writingEvaluationService.evaluateWriting(
      id,
      req.user.id,
      req.user.role,
    );
  }

  @Post('assignments/:id/reassign')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  reassignAssignment(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.reassign(id);
  }

  @Delete('assignments/:id')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  deleteAssignment(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.assignmentService.delete(id);
  }
}
