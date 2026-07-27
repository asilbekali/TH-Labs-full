import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateWaitListDto } from './dto/create-wait-list.dto';
import { UpdateWaitListDto } from './dto/update-wait-list.dto';

@Injectable()
export class WaitListService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createWaitListDto: CreateWaitListDto) {
    try {
      return await this.prisma.waitlist.create({
        data: {
          name: createWaitListDto.userName,
          email: createWaitListDto.email,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already on the wait list');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.waitlist.findMany();
  }

  async findOne(id: number) {
    const entry = await this.prisma.waitlist.findUnique({ where: { id } });

    if (!entry) throw new NotFoundException(`Wait list entry #${id} not found`);

    return entry;
  }

  async update(id: number, updateWaitListDto: UpdateWaitListDto) {
    await this.findOne(id);

    try {
      return await this.prisma.waitlist.update({
        where: { id },
        data: {
          ...(updateWaitListDto.userName !== undefined && {
            name: updateWaitListDto.userName,
          }),
          ...(updateWaitListDto.email !== undefined && {
            email: updateWaitListDto.email,
          }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already on the wait list');
      }
      throw error;
    }
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.waitlist.delete({ where: { id } });
    return { message: `Wait list entry #${id} removed` };
  }
}
