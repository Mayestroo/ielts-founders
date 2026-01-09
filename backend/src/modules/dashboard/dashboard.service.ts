import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [totalUsers, examSections, activeAssignments, completedTests] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.examSection.count(),
        this.prisma.examAssignment.count({
          where: { status: { not: 'SUBMITTED' } },
        }),
        this.prisma.examResult.count(),
      ]);

    // Recent Activity
    const newUsers = await this.prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        username: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });

    const newResults = await this.prisma.examResult.findMany({
      take: 5,
      orderBy: { submittedAt: 'desc' },
      include: {
        student: {
          select: { username: true, firstName: true, lastName: true },
        },
      },
    });

    const newSections = await this.prisma.examSection.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: {
          select: { username: true, firstName: true, lastName: true },
        },
      },
    });

    const activity = [
      ...newUsers.map((u) => ({
        type: 'info',
        action: 'User registered',
        user: u.firstName ? `${u.firstName} ${u.lastName || ''}` : u.username,
        time: u.createdAt,
      })),
      ...newResults.map((r) => ({
        type: 'success',
        action: 'New exam submitted',
        user: r.student.firstName
          ? `${r.student.firstName} ${r.student.lastName || ''}`
          : r.student.username,
        time: r.submittedAt,
      })),
      ...newSections.map((s) => ({
        type: 'default',
        action: 'Exam section created',
        user: s.teacher.firstName
          ? `${s.teacher.firstName} ${s.teacher.lastName || ''}`
          : s.teacher.username,
        time: s.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);

    return {
      counts: {
        totalUsers,
        examSections,
        activeAssignments,
        completedTests,
      },
      activity,
    };
  }
}
