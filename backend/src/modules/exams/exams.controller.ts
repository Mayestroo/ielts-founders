import {
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
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateAssignmentDto,
  CreateExamSectionDto,
  SaveHighlightsDto,
  SubmitAnswersDto,
  UpdateExamSectionDto,
} from './dto';
import { ExamsService } from './exams.service';

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
  constructor(private examsService: ExamsService) {}

  // ========== EXAM SECTIONS ==========

  @Post('exam-sections')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  createSection(
    @Body() createSectionDto: CreateExamSectionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.createSection(
      createSectionDto,
      req.user.id,
      req.user.centerId!,
    );
  }

  @Get('exam-sections')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  findAllSections(@Request() req: AuthenticatedRequest) {
    return this.examsService.findAllSections(
      req.user.role,
      req.user.centerId,
      req.user.id,
    );
  }

  @Get('exam-sections/:id')
  findSectionById(@Param('id') id: string) {
    return this.examsService.findSectionById(id);
  }

  @Put('exam-sections/:id')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  updateSection(
    @Param('id') id: string,
    @Body() updateSectionDto: UpdateExamSectionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.updateSection(
      id,
      updateSectionDto,
      req.user.id,
      req.user.role,
    );
  }

  @Delete('exam-sections/:id')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  deleteSection(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.examsService.deleteSection(id, req.user.id, req.user.role);
  }

  // ========== ASSIGNMENTS ==========

  @Post('assignments')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN)
  createAssignment(
    @Body() createAssignmentDto: CreateAssignmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.createAssignment(
      createAssignmentDto,
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
    return this.examsService.findAllAssignments(
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
    return this.examsService.getStudentAssignments(
      studentId,
      req.user.id,
      req.user.role,
    );
  }

  @Get('assignments/my')
  getMyAssignments(@Request() req: AuthenticatedRequest) {
    return this.examsService.getStudentAssignments(
      req.user.id,
      req.user.id,
      req.user.role,
    );
  }

  @Get('assignments/:id')
  getAssignmentDetails(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.getAssignmentDetails(
      id,
      req.user.id,
      req.user.role,
    );
  }

  @Post('assignments/:id/start')
  @Roles(Role.STUDENT)
  startExam(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.examsService.startExam(id, req.user.id);
  }

  @Post('assignments/:id/submit')
  @Roles(Role.STUDENT)
  submitAnswers(
    @Param('id') id: string,
    @Body() submitDto: SubmitAnswersDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.submitAnswers(id, submitDto, req.user.id);
  }

  @Post('assignments/:id/highlight')
  @Roles(Role.STUDENT)
  saveHighlights(
    @Param('id') id: string,
    @Body() highlightsDto: SaveHighlightsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.examsService.saveHighlights(id, highlightsDto, req.user.id);
  }

  // ========== RESULTS ==========

  @Get('results')
  @Roles(Role.TEACHER, Role.CENTER_ADMIN, Role.SUPER_ADMIN)
  findAllResults(
    @Request() req: AuthenticatedRequest,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
  ) {
    return this.examsService.findAllResults(
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
    return this.examsService.getStudentResults(
      studentId,
      req.user.id,
      req.user.role,
      req.user.centerId,
    );
  }

  @Get('results/:id')
  getResultById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.examsService.getResultById(
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
  ) {
    return this.examsService.evaluateWritingWithAI(
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
    return this.examsService.reassignAssignment(id, req.user.id, req.user.role);
  }
}
