import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(user: any) {
    const { role, centerId, id: userId } = user;
    const isSuperAdmin = role === 'SUPER_ADMIN';

    // Build where clause for center scoping
    const centerFilter = !isSuperAdmin && centerId ? { centerId } : {};
    
    // For non-super admins with no centerId (shouldn't happen but safe guard), we might return 0
    // But passing { centerId: undefined } to prisma means "no filter" which is dangerous (shows all).
    // EXCEPT Prisma checks for undefined. If value is undefined, it skips the field.
    // We must ensure that if !isSuperAdmin, we STRICTLY filter.
    
    const safeCenterFilter = isSuperAdmin ? {} : { centerId: centerId || 'non-existent-id' };
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [
      totalUsers, 
      examSections, 
      activeAssignments, 
      completedTests,
      newUsersLast30d,
      newSectionsLast30d,
      newResultsLast30d,
      newAssignmentsLast30d,
      newAssignmentsPrev30d
    ] =
      await Promise.all([
        this.prisma.user.count({ where: safeCenterFilter }),
        this.prisma.examSection.count({ where: safeCenterFilter }),
        this.prisma.examAssignment.count({
          where: {
            status: { not: 'SUBMITTED' },
            ...(isSuperAdmin ? {} : { student: { centerId: centerId || 'non-existent-id' } }),
          },
        }),
        this.prisma.examResult.count({
          where: isSuperAdmin ? {} : { student: { centerId: centerId || 'non-existent-id' } },
        }),
        // Growth Metrics
        this.prisma.user.count({
          where: { ...safeCenterFilter, createdAt: { gte: thirtyDaysAgo } }
        }),
        this.prisma.examSection.count({
          where: { ...safeCenterFilter, createdAt: { gte: thirtyDaysAgo } }
        }),
        this.prisma.examResult.count({
          where: { 
            ...(isSuperAdmin ? {} : { student: { centerId: centerId || 'non-existent-id' } }),
            submittedAt: { gte: thirtyDaysAgo } 
          }
        }),
        this.prisma.examAssignment.count({
          where: {
            ...(isSuperAdmin ? {} : { student: { centerId: centerId || 'non-existent-id' } }),
            createdAt: { gte: thirtyDaysAgo }
          }
        }),
        this.prisma.examAssignment.count({
          where: {
            ...(isSuperAdmin ? {} : { student: { centerId: centerId || 'non-existent-id' } }),
            createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }
          }
        })
      ]);

      const calculateGrowth = (total: number, newInPeriod: number) => {
        const prev = total - newInPeriod;
        if (prev <= 0) return 100; // If previously 0, 100% growth
        return Math.round((newInPeriod / prev) * 100);
      };

      const calculateTrend = (current: number, prev: number) => {
        if (prev <= 0) return 100;
        return Math.round(((current - prev) / prev) * 100);
      };

      const growth = {
        users: calculateGrowth(totalUsers, newUsersLast30d),
        sections: calculateGrowth(examSections, newSectionsLast30d),
        // For active assignments, we compare inflow trend because 'active' is a snapshot
        assignments: calculateTrend(newAssignmentsLast30d, newAssignmentsPrev30d),
        completedTests: calculateGrowth(completedTests, newResultsLast30d),
      };

    // Recent Activity
    const newUsers = await this.prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      where: safeCenterFilter,
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
      where: isSuperAdmin
        ? {}
        : {
            student: { centerId: centerId || 'non-existent-id' },
          },
      include: {
        student: {
          select: { username: true, firstName: true, lastName: true },
        },
      },
    });

    const newSections = await this.prisma.examSection.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      where: safeCenterFilter,
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
      growth,
      activity,
    };
  }
}
