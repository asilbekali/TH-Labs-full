import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreditReason, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { MailService } from '../mail/mail.service';
import {
  FREE_MINUTE_SECONDS,
  SIGNUP_BONUS_CREDITS,
} from '../payment/quality-cost';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // This is public registration — POST /users/create-user. Creating the account
  // *is* registering, so the welcome email belongs here rather than in AuthService.
  //
  // Registration also grants the free minute. It is a real SIGNUP_BONUS ledger
  // entry written in the same transaction as the account, not a column default:
  // the ledger is the source of truth for the balance, so credits that appear
  // without a matching row are drift by construction, and the cached balance
  // and the ledger would disagree for every account from the moment it existed.
  //
  // One transaction, so an account can never exist with the bonus missing —
  // which would silently hand a brand-new user an empty wallet and a 402 on
  // their first dub.
  async create(createUserDto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      SALT_ROUNDS,
    );

    try {
      const user = await this.prisma.transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            ...createUserDto,
            password: hashedPassword,
            credits: SIGNUP_BONUS_CREDITS,
          },
          select: PUBLIC_USER_SELECT,
        });
        await tx.creditEntry.create({
          data: {
            userId: created.id,
            delta: SIGNUP_BONUS_CREDITS,
            balance: SIGNUP_BONUS_CREDITS,
            reason: CreditReason.SIGNUP_BONUS,
            note: `welcome bonus — ${FREE_MINUTE_SECONDS}s of free dubbing`,
          },
        });
        return created;
      }, 'registerUser');

      // Fire-and-forget: the account exists either way, and MailService
      // swallows and logs its own failures — registration must not fail on a
      // mail error.
      void this.mail.sendSignupWelcome(user.email, user.name);

      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already in use');
      }
      throw error;
    }
  }

  async findAll(): Promise<{ usersCount: number }> {
    const usersCount = await this.prisma.user.count();
    return { usersCount };
  }

  findAllUsers() {
    return this.prisma.user.findMany({ select: PUBLIC_USER_SELECT });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });

    if (!user) throw new NotFoundException(`User #${id} not found`);

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);

    const data = { ...updateUserDto };
    if (data.password) {
      data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: PUBLIC_USER_SELECT,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { message: `User #${id} removed` };
  }

  async updateRole(id: number, role: Role) {
    await this.findOne(id);

    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: PUBLIC_USER_SELECT,
    });
  }
}
