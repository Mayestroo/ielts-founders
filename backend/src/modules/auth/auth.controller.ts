import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Request,
    Res,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleRegisterDto } from './dto/google-register.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
    role: string;
    centerId: string | null;
  };
}

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const parseCookieHeader = (headerValue?: string) => {
  const cookies: Record<string, string> = {};
  if (!headerValue) {
    return cookies;
  }

  for (const chunk of headerValue.split(';')) {
    const [rawName, ...rawValue] = chunk.trim().split('=');
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    cookies[rawName] = decodeURIComponent(rawValue.join('='));
  }

  return cookies;
};

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24,
    });

    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }

  private clearAuthCookies(res: Response) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.clearCookie(ACCESS_COOKIE, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });

    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });
  }

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.login(loginDto);
    this.setAuthCookies(res, payload.access_token, payload.refresh_token);
    return payload;
  }

  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.register(registerDto);
    this.setAuthCookies(res, payload.access_token, payload.refresh_token);
    return payload;
  }

  @Post('google/register')
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  async registerWithGoogle(
    @Body() googleRegisterDto: GoogleRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload =
      await this.authService.registerWithGoogle(googleRegisterDto);
    this.setAuthCookies(res, payload.access_token, payload.refresh_token);
    return payload;
  }

  @Post('google/login')
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  async loginWithGoogle(
    @Body() googleAuthDto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.loginWithGoogle(
      googleAuthDto.idToken,
    );
    this.setAuthCookies(res, payload.access_token, payload.refresh_token);
    return payload;
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  async getProfile(@Request() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.id, req.user.role);
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async refresh(
    @Body('refresh_token') refreshToken: string | undefined,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const effectiveRefreshToken = refreshToken || cookies[REFRESH_COOKIE];
    const payload = await this.authService.refreshAccessToken(
      effectiveRefreshToken,
    );
    this.setAuthCookies(res, payload.access_token, payload.refresh_token);
    return payload;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: ExpressRequest,
    @Body('refresh_token') refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = parseCookieHeader(req.headers.cookie);
    await this.authService.logout(
      refreshToken || cookies[REFRESH_COOKIE] || null,
    );
    this.clearAuthCookies(res);
  }
}
