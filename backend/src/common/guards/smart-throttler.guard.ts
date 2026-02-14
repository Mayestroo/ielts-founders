import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { verify } from 'jsonwebtoken';

interface RequestWithAuth {
  user?: {
    id?: string;
  };
  method?: string;
  url?: string;
  originalUrl?: string;
  route?: {
    path?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

@Injectable()
export class SmartThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: RequestWithAuth) {
    const userId =
      typeof req.user?.id === 'string' && req.user.id.trim().length > 0
        ? req.user.id
        : null;
    if (userId) {
      return `user:${userId}`;
    }

    const tokenUserId = this.extractUserIdFromAuthorization(req.headers);
    if (tokenUserId) {
      return `user:${tokenUserId}`;
    }

    const method = String(req.method || '').toUpperCase();
    const routePath = this.resolveRoutePath(req);
    const ip = this.resolveIp(req);

    if (method === 'POST' && routePath.includes('/auth/login')) {
      const username =
        typeof req.body?.username === 'string'
          ? req.body.username.trim().toLowerCase()
          : '';
      return username.length > 0
        ? `login:${ip}:${username}`
        : `login:${ip}:anonymous`;
    }

    if (
      method === 'POST' &&
      (routePath.includes('/auth/refresh') ||
        routePath.includes('/auth/logout'))
    ) {
      const token =
        this.extractRefreshTokenFromBody(req.body) ||
        this.extractCookieValue(req.headers, 'refresh_token');
      if (!token) {
        return `refresh:${ip}:anonymous`;
      }

      const tokenHash = createHash('sha256')
        .update(token)
        .digest('hex')
        .slice(0, 16);
      return `refresh:${ip}:${tokenHash}`;
    }

    return `ip:${ip}`;
  }

  private resolveRoutePath(req: RequestWithAuth): string {
    const rawPath = req.originalUrl || req.url || req.route?.path;
    return String(rawPath || '').toLowerCase();
  }

  private resolveIp(req: RequestWithAuth): string {
    const forwardedFor = this.readHeader(req.headers, 'x-forwarded-for');
    if (forwardedFor) {
      const first = forwardedFor
        .split(',')
        .map((part) => part.trim())
        .find((part) => part.length > 0);
      if (first) {
        return first;
      }
    }

    const realIp = this.readHeader(req.headers, 'x-real-ip');
    if (realIp) {
      return realIp;
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    key: string,
  ): string | null {
    if (!headers) {
      return null;
    }

    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0] || null;
    }

    return typeof value === 'string' ? value : null;
  }

  private extractCookieValue(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): string | null {
    const cookieHeader = this.readHeader(headers, 'cookie');
    if (!cookieHeader) {
      return null;
    }

    for (const part of cookieHeader.split(';')) {
      const [rawName, ...rawValue] = part.trim().split('=');
      if (rawName !== name || rawValue.length === 0) {
        continue;
      }

      return decodeURIComponent(rawValue.join('='));
    }

    return null;
  }

  private extractRefreshTokenFromBody(
    body: Record<string, unknown> | undefined,
  ): string | null {
    if (!body) {
      return null;
    }

    const token = body.refresh_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  }

  private extractUserIdFromAuthorization(
    headers: Record<string, string | string[] | undefined> | undefined,
  ): string | null {
    const authorization = this.readHeader(headers, 'authorization');
    if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
      return null;
    }

    const token = authorization.slice(7).trim();
    if (!token) {
      return null;
    }

    try {
      const payload = verify(token, process.env.JWT_SECRET || 'secret');
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const candidate = payload as { sub?: unknown; type?: unknown };
      if (candidate.type === 'refresh') {
        return null;
      }

      return typeof candidate.sub === 'string' && candidate.sub.length > 0
        ? candidate.sub
        : null;
    } catch {
      return null;
    }
  }
}
