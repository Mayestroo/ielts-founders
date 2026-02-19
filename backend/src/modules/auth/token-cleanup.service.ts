import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM) // Daily at 3 AM
  async cleanupExpiredTokens() {
    this.logger.debug('Starting expired token cleanup...');
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days grace period for expired tokens?
    // Actually, refresh tokens have an expiration. We should delete anything expired > N days ago.
    // The proposal said: "expired/revoked tokens older than 7 days".
    // Let's stick to the proposal.

    const deleted = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          // Revoked tokens older than cutoff
          {
            revokedAt: { lt: cutoff },
          },
          // Expired tokens (grace period of 7 days after expiration)
          {
            expiresAt: { lt: cutoff },
          },
        ],
      },
    });
    this.logger.log(
      `Cleaned up ${deleted.count} expired/revoked refresh tokens`,
    );
  }
}
