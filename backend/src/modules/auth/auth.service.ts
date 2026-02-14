import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

interface RefreshPayload {
  sub: string;
  type: 'refresh';
  jti: string;
  family: string;
  exp: number;
}

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.refreshSecret =
      configService.get<string>('JWT_REFRESH_SECRET') ||
      (configService.get<string>('JWT_SECRET') || 'secret') + '-refresh';
    this.refreshExpiresIn =
      configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
  }

  private sanitizeCenter(center: any) {
    if (!center) {
      return center;
    }

    const { loginPassword, ...safeCenter } = center;
    return {
      ...safeCenter,
      hasLoginPassword: Boolean(loginPassword),
    };
  }

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { center: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, center, ...result } = user;
    return {
      ...result,
      center: this.sanitizeCenter(center),
    };
  }

  private createAccessPayload(user: {
    id: string;
    username: string;
    role: string;
    centerId: string | null;
  }) {
    return {
      sub: user.id,
      username: user.username,
      role: user.role,
      centerId: user.centerId,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private createRefreshToken(
    userId: string,
    family: string,
  ): { token: string; payload: RefreshPayload } {
    const payload = {
      sub: userId,
      type: 'refresh',
      jti: randomUUID(),
      family,
    } as const;

    const token = this.jwtService.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresIn as any,
    });

    const verifiedPayload = this.jwtService.verify<RefreshPayload>(token, {
      secret: this.refreshSecret,
    });

    return { token, payload: verifiedPayload };
  }

  private async persistRefreshToken(token: string, payload: RefreshPayload) {
    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: this.hashToken(token),
        family: payload.family,
        expiresAt: new Date(payload.exp * 1000),
      },
    });
  }

  private async revokeTokenFamily(family: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        family,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);

    const payload = this.createAccessPayload(user);

    const access_token = this.jwtService.sign(payload);
    const refreshFamily = randomUUID();
    const { token: refresh_token, payload: refreshPayload } =
      this.createRefreshToken(user.id, refreshFamily);

    await this.persistRefreshToken(refresh_token, refreshPayload);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        centerId: user.centerId,
        center: this.sanitizeCenter(user.center),
      },
    };
  }

  /**
   * Validate a refresh token, rotate it, and issue a new access token.
   */
  async refreshAccessToken(refreshToken: string | undefined) {
    try {
      if (!refreshToken) {
        throw new UnauthorizedException('Refresh token is required');
      }

      const decoded = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
      });

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const currentTokenHash = this.hashToken(refreshToken);
      const now = new Date();

      const currentToken = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: currentTokenHash },
      });

      if (!currentToken) {
        await this.revokeTokenFamily(decoded.family);
        throw new UnauthorizedException('Refresh token revoked');
      }

      if (currentToken.revokedAt || currentToken.expiresAt <= now) {
        await this.revokeTokenFamily(currentToken.family);
        throw new UnauthorizedException('Refresh token expired or revoked');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, username: true, role: true, centerId: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const accessPayload = this.createAccessPayload(user);
      const access_token = this.jwtService.sign(accessPayload);
      const { token: rotated_refresh_token, payload: rotatedPayload } =
        this.createRefreshToken(user.id, currentToken.family);

      const rotatedTokenHash = this.hashToken(rotated_refresh_token);

      await this.prisma.$transaction(async (tx) => {
        const rotatedRecord = await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: rotatedTokenHash,
            family: currentToken.family,
            expiresAt: new Date(rotatedPayload.exp * 1000),
          },
        });

        const revokeCurrent = await tx.refreshToken.updateMany({
          where: {
            id: currentToken.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            replacedByTokenId: rotatedRecord.id,
          },
        });

        if (revokeCurrent.count !== 1) {
          await tx.refreshToken.updateMany({
            where: {
              family: currentToken.family,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });
          throw new UnauthorizedException('Refresh token already used');
        }
      });

      return {
        access_token,
        refresh_token: rotated_refresh_token,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(refreshToken: string | null) {
    if (!refreshToken) {
      return;
    }

    try {
      const decoded = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
      });

      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      if (decoded.family) {
        await this.revokeTokenFamily(decoded.family);
      }
    } catch {
      // Ignore invalid/expired refresh tokens on logout.
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { center: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, center, ...result } = user;
    return {
      ...result,
      center: this.sanitizeCenter(center),
    };
  }
}
