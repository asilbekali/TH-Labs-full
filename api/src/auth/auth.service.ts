import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './jwt.strategy';

// httpOnly cookie carrying the opaque refresh token. Scoped to the auth routes
// so it is only ever sent to /v1/auth/refresh and /v1/auth/logout.
export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/v1/auth';

type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>;

// ── Cross-origin handoff ────────────────────────────────────────────────────
// Sized so a code survives a redirect plus a slow first paint on the Studio,
// and nothing more. The Studio redeems it during boot, so this is a ceiling on
// network latency, not on how long a user might sit on a page.
const HANDOFF_TTL_SECONDS = 60;

// 32 bytes from the CSPRNG. base64url so it survives a query string untouched
// (no %-encoding, so no chance of a double-decode mismatch on the way back).
const HANDOFF_CODE_BYTES = 32;

function hashHandoffCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // ── Cookie plumbing ───────────────────────────────────────────────────────
  private cookieOptions(): CookieOptions {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:5173');
    const secure =
      appUrl.startsWith('https://') ||
      this.config.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      // Cross-site (prod) needs SameSite=None+Secure; localhost dev is same-site.
      sameSite: secure ? 'none' : 'lax',
      secure,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, raw: string): void {
    res.cookie(REFRESH_COOKIE, raw, this.cookieOptions());
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async login(dto: LoginDto, res: Response, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user, res, userAgent);
  }

  // Rotate the refresh cookie and mint a new access token. Reads the opaque
  // token from the httpOnly cookie — never the body or an Authorization header.
  async refresh(rawCookie: string | undefined, res: Response, userAgent?: string) {
    const { userId, raw } = await this.refreshTokens.rotate(rawCookie, userAgent);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid session');

    this.setRefreshCookie(res, raw);
    return { accessToken: this.signAccess(user), user: this.publicUser(user) };
  }

  async logout(rawCookie: string | undefined, res: Response) {
    await this.refreshTokens.revoke(rawCookie);
    this.clearRefreshCookie(res);
    return { message: 'Logged out successfully' };
  }

  // Current authenticated user, for the /auth/me bootstrap call.
  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid session');
    return this.publicUser(user);
  }

  // Issue a fresh access token + refresh cookie for an already-authenticated
  // user. Shared by login and by registration (users/create-user).
  async issueTokens(user: PublicUser, res: Response, userAgent?: string) {
    const raw = await this.refreshTokens.issue(user.id, userAgent);
    this.setRefreshCookie(res, raw);
    return { accessToken: this.signAccess(user), user: this.publicUser(user) };
  }

  private signAccess(user: PublicUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET', 'dev-secret'),
      expiresIn: this.config.get<string>(
        'JWT_EXPIRES_IN',
        '15m',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private publicUser(user: PublicUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
