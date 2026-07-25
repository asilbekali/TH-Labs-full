import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

const SALT_ROUNDS = 10;
const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.SUPERADMIN];

const PUBLIC_ADMIN_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createAdminDto: CreateAdminDto) {
    const hashedPassword = await bcrypt.hash(
      createAdminDto.password,
      SALT_ROUNDS,
    );

    try {
      return await this.prisma.user.create({
        data: {
          ...createAdminDto,
          password: hashedPassword,
          role: createAdminDto.role ?? Role.ADMIN,
        },
        select: PUBLIC_ADMIN_SELECT,
      });
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

  findAll() {
    return this.prisma.user.findMany({
      where: { role: { in: ADMIN_ROLES } },
      select: PUBLIC_ADMIN_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const admin = await this.prisma.user.findFirst({
      where: { id, role: { in: ADMIN_ROLES } },
      select: PUBLIC_ADMIN_SELECT,
    });

    if (!admin) throw new NotFoundException(`Admin #${id} not found`);

    return admin;
  }

  async update(id: number, updateAdminDto: UpdateAdminDto) {
    await this.findOne(id);

    const data = { ...updateAdminDto };
    if (data.password) {
      data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: PUBLIC_ADMIN_SELECT,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { message: `Admin #${id} removed` };
  }
}
