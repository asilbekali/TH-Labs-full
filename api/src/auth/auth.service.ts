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

  // ── Cross-origin handoff ────────────────────────────────────────────────
  // The refresh token is an httpOnly cookie scoped to this origin, so it
  // cannot follow a user to the Studio on *.modal.run. These two endpoints
  // move the session there without a token ever appearing in a URL.

  /**
   * Mint a single-use code that carries this session to another origin.
   *
   * Called server-to-server by the landing page with the access token it just
   * received, so the browser is handed the code INSTEAD of anything reusable.
   * Only the hash is stored; the raw code is returned once, here.
   */
  async createHandoffCode(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid session');

    const code = randomBytes(HANDOFF_CODE_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000);

    await this.prisma.handoffCode.create({
      data: { codeHash: hashHandoffCode(code), userId, expiresAt },
    });

    // Opportunistic sweep of rows that can no longer be redeemed. Cheap (the
    // expiresAt index covers it) and avoids needing a scheduled job.
    await this.deleteExpiredCodes();

    return { code, expiresIn: HANDOFF_TTL_SECONDS };
  }

  /**
   * Redeem a handoff code. Public endpoint — the code itself is the only
   * credential, which is why it must be unguessable, short-lived and
   * single-use.
   *
   * Goes through issueTokens, so redemption sets the same rotated httpOnly
   * refresh cookie a normal login would and returns only the access token in
   * the body. The Studio must therefore call this with credentials:'include',
   * or the Set-Cookie is discarded and it will have no way to refresh.
   */
  async exchangeHandoffCode(code: string, res: Response, userAgent?: string) {
    // The claim and the validity check are ONE statement on purpose. Reading
    // the row, deciding it is usable, then marking it used would let two
    // requests arriving together both pass; `usedAt: null` inside the WHERE
    // makes the database the arbiter, so exactly one UPDATE can match.
    const claimed = await this.prisma.handoffCode.updateMany({
      where: {
        codeHash: hashHandoffCode(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // One message for every failure — unknown, expired and already-spent are
    // indistinguishable to the caller, so this cannot be used to probe which
    // codes existed.
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired handoff code');
    }

    const record = await this.prisma.handoffCode.findUnique({
      where: { codeHash: hashHandoffCode(code) },
      include: { user: true },
    });
    if (!record) {
      throw new UnauthorizedException('Invalid or expired handoff code');
    }

    return this.issueTokens(record.user, res, userAgent);
  }

  async deleteExpiredCodes() {
    return this.prisma.handoffCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
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
