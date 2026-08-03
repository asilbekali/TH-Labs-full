import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

// Opaque, rotated refresh tokens backed by the RefreshToken table.
//
// The raw token is a 32-byte random string handed to the client in an httpOnly
// cookie; we only ever store its SHA-256 hash. Rotation revokes the presented
// token and issues a fresh one on every refresh. If a *already-revoked* token
// is ever presented again that is treated as theft — every token for that user
// is revoked, forcing a fresh login.
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Refresh-token lifetime, parsed from JWT_REFRESH_EXPIRES_IN (e.g. "30d",
  // "7d", "24h"). Falls back to 30 days.
  private ttlMs(): number {
    const raw = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d');
    const m = /^(\d+)\s*([smhd])$/.exec(raw.trim());
    if (!m) return 30 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2]] ?? 86400e3;
    return n * unit;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  // Mint a new refresh token for a user and return the raw value (only the
  // caller and the client's cookie ever see it).
  async issue(userId: number, userAgent?: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + this.ttlMs()),
        userAgent: userAgent ?? null,
      },
    });
    return raw;
  }

  // Validate + rotate. Returns the userId and a fresh raw token. Throws 401 on
  // any invalid / expired / reused token.
  async rotate(
    raw: string | undefined,
    userAgent?: string,
  ): Promise<{ userId: number; raw: string }> {
    if (!raw) throw new UnauthorizedException('Missing refresh token');

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });

    if (!record) throw new UnauthorizedException('Invalid session');

    // Reuse of an already-revoked token → treat as compromise, nuke the family.
    if (record.revokedAt) {
      this.logger.warn(
        `Reused refresh token for user ${record.userId} — revoking all sessions`,
      );
      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException('Session revoked');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session expired');
    }

    // Rotate: revoke the presented token, mint a replacement.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const next = await this.issue(record.userId, userAgent);
    return { userId: record.userId, raw: next };
  }

  // Revoke a single presented token (logout). Silent if it doesn't exist.
  async revoke(raw: string | undefined): Promise<void> {
    if (!raw) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
