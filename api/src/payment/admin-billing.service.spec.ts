import { NotFoundException } from '@nestjs/common';
import { CreditReason, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminBillingService } from './admin-billing.service';
import type { LemonSqueezyService } from './lemonsqueezy.service';
import type { PaymentService } from './payment.service';

describe('AdminBillingService.giftCredits', () => {
  const superAdmin: AuthenticatedUser = {
    id: 1,
    email: 'root@example.com',
    role: Role.SUPERADMIN,
  };
  const ada = { id: 42, email: 'ada@example.com', name: 'Ada' };

  let grantCredits: jest.Mock;
  let service: AdminBillingService;

  beforeEach(() => {
    grantCredits = jest.fn(() => Promise.resolve(800));
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(where.id === ada.id ? ada : null),
        ),
      },
    };
    service = new AdminBillingService(
      prisma as unknown as PrismaService,
      {} as LemonSqueezyService,
      { grantCredits } as unknown as PaymentService,
    );
  });

  it('writes an ADMIN_ADJUSTMENT entry and answers the new balance', async () => {
    await expect(
      service.giftCredits(
        42,
        { credits: 500, note: ' Thanks for the bug reports ' },
        superAdmin,
      ),
    ).resolves.toEqual({ user: ada, granted: 500, balance: 800 });

    expect(grantCredits).toHaveBeenCalledWith(
      42,
      500,
      CreditReason.ADMIN_ADJUSTMENT,
      'admin:1',
      'Gift: Thanks for the bug reports',
    );
  });

  it('keeps the giver out of the note the user reads', async () => {
    await service.giftCredits(42, { credits: 10 }, superAdmin);
    expect(grantCredits).toHaveBeenCalledWith(
      42,
      10,
      CreditReason.ADMIN_ADJUSTMENT,
      'admin:1',
      'Gift',
    );
  });

  it('refuses an account that does not exist, and grants nothing', async () => {
    await expect(
      service.giftCredits(999, { credits: 500 }, superAdmin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
