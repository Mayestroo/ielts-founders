import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Role,
  SessionAttendanceMode,
  SessionReferralSource,
} from '@prisma/client';
import { randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { GoogleRegisterDto } from './dto/google-register.dto';
import { RegisterDto } from './dto/register.dto';

interface RefreshPayload {
  sub: string;
  type: 'refresh';
  jti: string;
  family: string;
  exp: number;
}

interface AuthUser {
  id: string;
  username: string;
  role: string;
  centerId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sessionAttendanceMode?: SessionAttendanceMode;
  sessionScheduledAt?: Date | null;
  sessionReferralSource?: SessionReferralSource | null;
  phoneNumber?: string | null;
  center?: unknown;
}

interface GoogleTokenInfo {
  aud: string;
  email: string;
  email_verified: string | boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
}

interface SessionRegistrationInput {
  firstName: string;
  lastName: string;
  attendanceMode: SessionAttendanceMode;
  scheduledAt: string;
  referralSource: SessionReferralSource;
  phoneNumber: string;
}

const POINTS_BY_AVERAGE_BAND: Array<{ minBand: number; points: number }> = [
  { minBand: 9.0, points: 200 },
  { minBand: 8.5, points: 100 },
  { minBand: 8.0, points: 50 },
  { minBand: 7.5, points: 30 },
  { minBand: 7.0, points: 20 },
  { minBand: 6.5, points: 10 },
  { minBand: 6.0, points: 5 },
];

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

  private getGoogleClientId(): string {
    const googleClientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') ||
      this.configService.get<string>('NEXT_PUBLIC_GOOGLE_CLIENT_ID');

    if (!googleClientId) {
      throw new UnauthorizedException('Google sign-in is not configured');
    }

    return googleClientId;
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
    const token = idToken?.trim();
    if (!token) {
      throw new UnauthorizedException('Google token is required');
    }

    const googleClientId = this.getGoogleClientId();

    let payload: Partial<GoogleTokenInfo>;
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      );

      if (!response.ok) {
        throw new UnauthorizedException('Invalid Google token');
      }

      payload = (await response.json()) as Partial<GoogleTokenInfo>;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Unable to verify Google token');
    }

    const isEmailVerified =
      payload.email_verified === true || payload.email_verified === 'true';

    if (payload.aud !== googleClientId || !payload.email || !isEmailVerified) {
      throw new UnauthorizedException('Google authentication failed');
    }

    return payload as GoogleTokenInfo;
  }

  private async resolveDefaultStudentCenterId(): Promise<string | null> {
    const configuredCenterId =
      this.configService.get<string>('DEFAULT_STUDENT_CENTER_ID')?.trim() ||
      this.configService.get<string>('GOOGLE_DEFAULT_CENTER_ID')?.trim() ||
      '';

    if (configuredCenterId) {
      const configuredCenter = await this.prisma.center.findUnique({
        where: { id: configuredCenterId },
        select: { id: true },
      });

      if (!configuredCenter) {
        throw new UnauthorizedException(
          'Default student center is not configured correctly',
        );
      }

      return configuredCenter.id;
    }

    const centers = await this.prisma.center.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });

    if (centers.length === 1) {
      return centers[0].id;
    }

    return null;
  }

  private parseSessionRegistration(input: SessionRegistrationInput) {
    const normalizedFirstName = input.firstName.trim();
    const normalizedLastName = input.lastName.trim();
    const normalizedPhoneNumber = input.phoneNumber.trim();
    const scheduledAt = new Date(input.scheduledAt);

    if (!normalizedFirstName || !normalizedLastName || !normalizedPhoneNumber) {
      throw new UnauthorizedException('Invalid registration details');
    }

    if (Number.isNaN(scheduledAt.getTime())) {
      throw new UnauthorizedException('Invalid test session time');
    }

    return {
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      attendanceMode: input.attendanceMode,
      scheduledAt,
      referralSource: input.referralSource,
      phoneNumber: normalizedPhoneNumber,
    };
  }

  private async issueAuthTokens(user: AuthUser) {
    const payload = this.createAccessPayload(user);
    const access_token = this.jwtService.sign(payload);
    const refreshFamily = randomUUID();
    const { token: refresh_token, payload: refreshPayload } =
      this.createRefreshToken(user.id, refreshFamily);

    await this.persistRefreshToken(refresh_token, refreshPayload);
    const points = await this.calculateUserPoints(user.id, user.role);

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
        sessionAttendanceMode: user.sessionAttendanceMode,
        sessionScheduledAt: user.sessionScheduledAt ?? null,
        sessionReferralSource: user.sessionReferralSource ?? null,
        phoneNumber: user.phoneNumber ?? null,
        center: this.sanitizeCenter(user.center),
        points,
      },
    };
  }

  private mapAverageBandToPoints(averageBand: number | null): number {
    if (averageBand === null || !Number.isFinite(averageBand)) {
      return 0;
    }

    for (const rule of POINTS_BY_AVERAGE_BAND) {
      if (averageBand >= rule.minBand) {
        return rule.points;
      }
    }

    return 0;
  }

  private async calculateUserPoints(
    userId: string,
    role: string,
  ): Promise<number> {
    if (role !== 'STUDENT') {
      return 0;
    }

    const averageBand = await this.prisma.examResult.aggregate({
      where: {
        studentId: userId,
        bandScore: {
          not: null,
        },
      },
      _avg: {
        bandScore: true,
      },
    });

    return this.mapAverageBandToPoints(averageBand._avg.bandScore ?? null);
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
      center,
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
    return this.issueAuthTokens(user);
  }

  async register(registerDto: RegisterDto) {
    const username = registerDto.username.trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const centerId = await this.resolveDefaultStudentCenterId();
    const session = this.parseSessionRegistration({
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      attendanceMode: registerDto.attendanceMode as SessionAttendanceMode,
      scheduledAt: registerDto.scheduledAt,
      referralSource: registerDto.referralSource as SessionReferralSource,
      phoneNumber: registerDto.phoneNumber,
    });

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: Role.STUDENT,
        centerId,
        firstName: session.firstName,
        lastName: session.lastName,
        sessionAttendanceMode: session.attendanceMode,
        sessionScheduledAt: session.scheduledAt,
        sessionReferralSource: session.referralSource,
        phoneNumber: session.phoneNumber,
      },
      include: { center: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...safeUser } = user;
    return this.issueAuthTokens(safeUser);
  }

  async registerWithGoogle(registerDto: GoogleRegisterDto) {
    const googleToken = await this.verifyGoogleIdToken(registerDto.idToken);
    const username = googleToken.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException(
        'Account already exists. Please continue with Login with Google.',
      );
    }

    const generatedPassword = await bcrypt.hash(randomUUID(), 10);
    const centerId = await this.resolveDefaultStudentCenterId();
    const session = this.parseSessionRegistration({
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      attendanceMode: registerDto.attendanceMode as SessionAttendanceMode,
      scheduledAt: registerDto.scheduledAt,
      referralSource: registerDto.referralSource as SessionReferralSource,
      phoneNumber: registerDto.phoneNumber,
    });

    const user = await this.prisma.user.create({
      data: {
        username,
        password: generatedPassword,
        firstName: session.firstName,
        lastName: session.lastName,
        centerId,
        sessionAttendanceMode: session.attendanceMode,
        sessionScheduledAt: session.scheduledAt,
        sessionReferralSource: session.referralSource,
        phoneNumber: session.phoneNumber,
      },
      include: { center: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...safeUser } = user;
    return this.issueAuthTokens(safeUser);
  }

  async loginWithGoogle(idToken: string) {
    const googleToken = await this.verifyGoogleIdToken(idToken);
    const username = googleToken.email.toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { center: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        'No account found. Please register with Google first.',
      );
    }

    let resolvedUser = user;

    if (!resolvedUser.centerId) {
      const centerId = await this.resolveDefaultStudentCenterId();

      if (centerId) {
        resolvedUser = await this.prisma.user.update({
          where: { id: user.id },
          data: { centerId },
          include: { center: true },
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...safeUser } = resolvedUser;
    return this.issueAuthTokens(safeUser);
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
    const points = await this.calculateUserPoints(user.id, user.role);

    return {
      ...result,
      center: this.sanitizeCenter(center),
      sessionAttendanceMode: user.sessionAttendanceMode,
      sessionScheduledAt: user.sessionScheduledAt,
      sessionReferralSource: user.sessionReferralSource,
      phoneNumber: user.phoneNumber,
      points,
    };
  }
}
