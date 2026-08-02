import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './jwt.strategy';

const SALT_ROUNDS = 10;

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
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  async refresh(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid session');

    return this.issueTokens(user);
  }

  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: null },
    });

    return { message: 'Logged out successfully' };
  }

  /**
   * Mint a single-use code that carries this session to another origin.
   *
   * Called by the landing page's server-side auth routes with the access token
   * they just received, so the browser is handed the code INSTEAD of the token
   * pair — the refresh token never reaches client-side JavaScript at all.
   *
   * Only the hash is stored. The raw code is returned once, here, and is
   * unrecoverable afterwards.
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
    // expiresAt index covers it) and keeps the table from growing without
    // bound without needing a scheduled job.
    await this.deleteExpiredCodes();

    return { code, expiresIn: HANDOFF_TTL_SECONDS };
  }

  /**
   * Redeem a handoff code for a real token pair. Public endpoint — the code
   * itself is the only credential, which is why it has to be unguessable,
   * short-lived, and single-use.
   */
  async exchangeHandoffCode(code: string) {
    // The claim and the validity check are ONE statement on purpose. Reading
    // the row, deciding it is usable, then marking it used would let two
    // requests arriving together both pass the check and both get tokens;
    // `usedAt: null` inside the WHERE makes the database the arbiter, so
    // exactly one UPDATE can match and the loser sees count === 0.
    const claimed = await this.prisma.handoffCode.updateMany({
      where: {
        codeHash: hashHandoffCode(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // Deliberately one message for every failure — unknown, expired, and
    // already-spent are indistinguishable to the caller, so this cannot be
    // used to probe which codes existed.
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired handoff code');
    }

    const record = await this.prisma.handoffCode.findUnique({
      where: { codeHash: hashHandoffCode(code) },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException('Invalid or expired handoff code');

    return this.issueTokens(record.user);
  }

  async deleteExpiredCodes() {
    return this.prisma.handoffCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  async validateRefreshToken(userId: number, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.hashedRefreshToken) {
      throw new UnauthorizedException('Invalid session');
    }

    const matches = await bcrypt.compare(refreshToken, user.hashedRefreshToken);

    if (!matches) throw new UnauthorizedException('Invalid session');

    return { id: user.id, email: user.email, role: user.role };
  }

  async issueTokens(
    user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>,
  ) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET', 'dev-secret'),
      expiresIn: this.config.get<string>(
        'JWT_EXPIRES_IN',
        '15m',
      ) as JwtSignOptions['expiresIn'],
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>(
        'JWT_REFRESH_SECRET',
        'dev-refresh-secret',
      ),
      expiresIn: this.config.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
        '7d',
      ) as JwtSignOptions['expiresIn'],
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        hashedRefreshToken: await bcrypt.hash(refreshToken, SALT_ROUNDS),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    };
  }
}
