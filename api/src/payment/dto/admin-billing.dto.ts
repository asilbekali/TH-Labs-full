import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Bodies for the admin billing panel.
//
// Every "product" field takes EITHER a Dodo product id (`pdt_…`) OR the whole
// payment link copied out of the dashboard — whichever the admin happens to
// have on their clipboard. The service derives the other half. Sending an
// empty string clears it, which is how a plan is taken off sale without
// deactivating it outright.

const PRICE_MAX = 100_000_00; // $100k, in cents — a typo guard, not a policy
const CREDITS_MAX = 10_000_000;

export class UpdatePlanDto {
  @ApiPropertyOptional({
    description:
      'Dodo product id (pdt_…) or its payment link. Empty string clears it.',
    example: 'https://checkout.dodopayments.com/buy/pdt_abc123',
  })
  @IsOptional()
  @IsString()
  dodoProduct?: string;

  @ApiPropertyOptional({
    description: 'Price in cents, matching the Dodo product',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX)
  priceCents?: number;

  @ApiPropertyOptional({ description: 'Credits handed out by ONE allocation' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CREDITS_MAX)
  creditsGranted?: number;

  @ApiPropertyOptional({ description: 'Days between allocations (7 or 30)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  grantDays?: number;

  @ApiPropertyOptional({
    description:
      'Allocations per paid period. 1 for weekly/monthly; 12 for yearly, which bills once and drips monthly.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  grantsPerPeriod?: number;

  @ApiPropertyOptional({
    description: 'Inactive plans are hidden and cannot be bought',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateCreditPackDto {
  @ApiProperty({
    description:
      'Stable public id. Travels in checkout metadata, so it cannot be renamed later.',
    example: 'pack_240',
  })
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9_-]{3,60}$/, {
    message:
      'slug must be 3-60 characters of lowercase letters, digits, underscore or hyphen',
  })
  slug!: string;

  @ApiProperty({ example: 240 })
  @IsInt()
  @Min(1)
  @Max(CREDITS_MAX)
  credits!: number;

  @ApiProperty({ description: 'Price in cents', example: 1345 })
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX)
  priceCents!: number;

  @ApiPropertyOptional({ default: 'usd' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional({
    description: 'Highlight this pack on the pricing page',
  })
  @IsOptional()
  @IsBoolean()
  popular?: boolean;

  @ApiPropertyOptional({ description: 'Display order; ties break on credits' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Dodo product id (pdt_…) or its payment link',
  })
  @IsOptional()
  @IsString()
  dodoProduct?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// Everything but the slug, which is immutable once a pack exists: it is the id
// the webhook reads back off a checkout that may already be in flight.
export class UpdateCreditPackDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CREDITS_MAX)
  credits?: number;

  @ApiPropertyOptional({ description: 'Price in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  popular?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Dodo product id (pdt_…) or its payment link. Empty string clears it.',
  })
  @IsOptional()
  @IsString()
  dodoProduct?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
