import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './jwt.strategy';

const SALT_ROUNDS = 10;

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
