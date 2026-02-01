import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import { WritingGradingJobData } from '../queue/writing-grading.types';
import {
  WritingSubmittedEvent,
  WritingGradedEvent,
  WritingGradingFailedEvent,
  ExamSubmittedEvent,
  ExamStartedEvent,
} from '../exam-events/exam.events';

/**
 * Event listener that bridges domain events to infrastructure (queue)
 * This decouples the exams module from the queue implementation
 */
@Injectable()
export class ExamEventListener {
  private readonly logger = new Logger(ExamEventListener.name);

  constructor(
    @InjectQueue(WRITING_GRADING_QUEUE)
    private writingQueue: Queue<WritingGradingJobData>,
  ) {}

  @OnEvent('writing.submitted')
  async handleWritingSubmitted(event: WritingSubmittedEvent) {
    this.logger.log(
      `Writing submitted event received for submission ${event.submissionId}`,
    );

    if (event.tasks.length === 0) {
      this.logger.warn(
        `No tasks to evaluate for submission ${event.submissionId}`,
      );
      return;
    }

    try {
      await this.writingQueue.add(
        'grade',
        {
          submissionId: event.submissionId,
          resultId: event.resultId,
          tasks: event.tasks,
        },
        {
          jobId: `writing-${event.submissionId}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      this.logger.log(`Job queued for submission ${event.submissionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue job for submission ${event.submissionId}: ${error}`,
      );
      throw error;
    }
  }

  @OnEvent('writing.graded')
  handleWritingGraded(event: WritingGradedEvent) {
    this.logger.log(
      `Writing graded event: submission ${event.submissionId} scored ${event.bandScore}`,
    );
    // Additional business logic can be added here:
    // - Send notifications
    // - Update analytics
    // - Trigger webhooks
  }

  @OnEvent('writing.gradingFailed')
  handleWritingGradingFailed(event: WritingGradingFailedEvent) {
    this.logger.error(
      `Writing grading failed for submission ${event.submissionId}: ${event.error}`,
    );
    // Additional error handling:
    // - Alert administrators
    // - Send failure notification to student
    // - Log for manual review
  }

  @OnEvent('exam.submitted')
  handleExamSubmitted(event: ExamSubmittedEvent) {
    this.logger.log(
      `Exam submitted: ${event.sectionType} assignment ${event.assignmentId} by student ${event.studentId}`,
    );
    // Analytics, notifications, etc.
  }

  @OnEvent('exam.started')
  handleExamStarted(event: ExamStartedEvent) {
    this.logger.log(
      `Exam started: assignment ${event.assignmentId} by student ${event.studentId}`,
    );
    // Log exam start for analytics
  }
}
