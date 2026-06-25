import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  centerId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('JWT_SECRET')?.trim();
    if (!jwtSecret) {
      throw new Error('JWT_SECRET must be configured');
    }

    const cookieExtractor = (req: Request): string | null => {
      const header = req?.headers?.cookie;
      if (!header) {
        return null;
      }

      for (const chunk of header.split(';')) {
        const [rawName, ...rawValue] = chunk.trim().split('=');
        if (rawName === 'access_token' && rawValue.length > 0) {
          return decodeURIComponent(rawValue.join('='));
        }
      }

      return null;
    };

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      centerId: payload.centerId,
    };
  }
}
