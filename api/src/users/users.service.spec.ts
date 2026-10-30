import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService.updateRole', () => {
  const accounts: Record<number, { id: number; role: Role }> = {
    1: { id: 1, role: Role.SUPERADMIN },
    2: { id: 2, role: Role.ADMIN },
    3: { id: 3, role: Role.USER },
    4: { id: 4, role: Role.ADMIN },
  };

  const superAdmin: AuthenticatedUser = {
    id: 1,
    email: 'root@example.com',
    role: Role.SUPERADMIN,
  };
  const admin: AuthenticatedUser = {
    id: 2,
    email: 'staff@example.com',
    role: Role.ADMIN,
  };

  let update: jest.Mock;
  let service: UsersService;

  beforeEach(() => {
    update = jest.fn(
      ({ where, data }: { where: { id: number }; data: { role: Role } }) =>
        Promise.resolve({ ...accounts[where.id], role: data.role }),
    );
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(accounts[where.id] ?? null),
        ),
        update,
      },
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      {} as MailService,
    );
  });

  it('lets an ADMIN promote a USER to ADMIN', async () => {
    await expect(
      service.updateRole(3, Role.ADMIN, admin),
    ).resolves.toMatchObject({
      id: 3,
      role: Role.ADMIN,
    });
  });

  it('lets an ADMIN demote another ADMIN to USER', async () => {
    await expect(
      service.updateRole(4, Role.USER, admin),
    ).resolves.toMatchObject({
      role: Role.USER,
    });
  });

  it('refuses an ADMIN granting SUPERADMIN', async () => {
    await expect(
      service.updateRole(3, Role.SUPERADMIN, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN changing a SUPERADMIN's role", async () => {
    await expect(
      service.updateRole(1, Role.USER, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN changing its own role', async () => {
    await expect(
      service.updateRole(2, Role.USER, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets a SUPERADMIN set any role on anyone', async () => {
    await expect(
      service.updateRole(3, Role.SUPERADMIN, superAdmin),
    ).resolves.toMatchObject({ role: Role.SUPERADMIN });
    await expect(
      service.updateRole(2, Role.USER, superAdmin),
    ).resolves.toMatchObject({ role: Role.USER });
  });

  it('answers 404 for an unknown user', async () => {
    await expect(
      service.updateRole(99, Role.ADMIN, superAdmin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
