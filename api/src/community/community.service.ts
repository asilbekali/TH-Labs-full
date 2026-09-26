import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(createCommunityDto: CreateCommunityDto) {
    try {
      const member = await this.prisma.community.create({
        data: {
          name: createCommunityDto.userName,
          email: createCommunityDto.email,
        },
      });

      // The whole point of joining: the welcome email goes out automatically.
      // Fire-and-forget — the member is already saved, and MailService
      // swallows and logs its own failures, so a bounced email can't undo a
      // good signup.
      void this.mail.sendCommunityWelcome(member.email, member.name);

      return member;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already in the community');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.community.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number) {
    const member = await this.prisma.community.findUnique({ where: { id } });

    if (!member) throw new NotFoundException(`Community member #${id} not found`);

    return member;
  }

  async update(id: number, updateCommunityDto: UpdateCommunityDto) {
    await this.findOne(id);

    try {
      return await this.prisma.community.update({
        where: { id },
        data: {
          ...(updateCommunityDto.userName !== undefined && {
            name: updateCommunityDto.userName,
          }),
          ...(updateCommunityDto.email !== undefined && {
            email: updateCommunityDto.email,
          }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already in the community');
      }
      throw error;
    }
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.community.delete({ where: { id } });
    return { message: `Community member #${id} removed` };
  }
}
