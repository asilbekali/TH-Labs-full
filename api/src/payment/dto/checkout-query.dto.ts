import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PlanTier, BillingCycle } from '@prisma/client';

// FREE is intentionally excluded — you cannot "check out" the free tier.
export enum PaidTier {
  PRO = 'PRO',
  STUDIO = 'STUDIO',
}

export class CheckoutQueryDto {
  @ApiProperty({ enum: PaidTier })
  @IsEnum(PaidTier)
  tier!: PaidTier;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  cycle!: BillingCycle;
}

// Re-export so callers get the prisma enums from one place.
export { PlanTier, BillingCycle };
