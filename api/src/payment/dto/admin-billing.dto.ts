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
// This is the whole of "wiring up a product": make it in the Lemon Squeezy
// dashboard, copy its share link and its variant id, and paste both here with
// the credits and the price. Nothing is deployed and no code changes.
//
// `checkoutUrl` must be a `https://<store>.lemonsqueezy.com/checkout/buy/…`
// URL — validated rather than taken on trust, because a wrong value here is a
// Buy button that sends a paying customer somewhere unintended. An empty
// string clears it, which takes an item off sale without deactivating it.
//
// `lsVariantId` is what a paid order is matched on, and it is required for an
// item to be sold at all: an order whose variant matches nothing cannot be
// credited. It is the number in the LS dashboard under Products → the product
// → Variants (or the `variant_id` on any test order).

const PRICE_MAX = 100_000_00; // $100k, in cents — a typo guard, not a policy
const CREDITS_MAX = 10_000_000;

// Lemon Squeezy's hosted checkout. Narrow on purpose — see above.
const CHECKOUT_URL =
  /^(https:\/\/[a-z0-9-]+\.lemonsqueezy\.com\/(checkout\/)?buy\/[A-Za-z0-9-]+(\?[\w\-=&.%[\]]*)?)?$/;
const CHECKOUT_URL_MESSAGE =
  'checkoutUrl must be a https://<store>.lemonsqueezy.com/checkout/buy/… URL, or empty to clear it';

const VARIANT_ID = /^(\d{1,15})?$/;
const VARIANT_ID_MESSAGE =
  'lsVariantId must be a Lemon Squeezy variant id (digits), or empty to clear it';

export class UpdatePlanDto {
  @ApiPropertyOptional({
    description:
      'Lemon Squeezy checkout link for this plan. Empty string clears it (takes it off sale).',
    example:
      'https://th-labs.lemonsqueezy.com/checkout/buy/158094fd-d3ba-4dfd-8e9d-f9d713036ea4',
  })
  @IsOptional()
  @IsString()
  @Matches(CHECKOUT_URL, { message: CHECKOUT_URL_MESSAGE })
  checkoutUrl?: string;

  @ApiPropertyOptional({
    description:
      'Lemon Squeezy variant id this link sells. Paid orders are matched on it.',
    example: '2203365',
  })
  @IsOptional()
  @IsString()
  @Matches(VARIANT_ID, { message: VARIANT_ID_MESSAGE })
  lsVariantId?: string;

  @ApiPropertyOptional({
    description:
      'Price in USD cents, as shown on the pricing page. Keep it equal to the Lemon Squeezy price; a large difference is logged on each purchase.',
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
      'Allocations per paid period. 1 for monthly; 12 for yearly, which bills once and drips monthly.',
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
      'Stable public id. Travels in the checkout custom data and the history, so it cannot be renamed later.',
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
    description: 'Lemon Squeezy checkout link for this pack',
    example:
      'https://th-labs.lemonsqueezy.com/checkout/buy/158094fd-d3ba-4dfd-8e9d-f9d713036ea4',
  })
  @IsOptional()
  @IsString()
  @Matches(CHECKOUT_URL, { message: CHECKOUT_URL_MESSAGE })
  checkoutUrl?: string;

  @ApiPropertyOptional({
    description:
      'Lemon Squeezy variant id this link sells. Paid orders are matched on it.',
    example: '2203420',
  })
  @IsOptional()
  @IsString()
  @Matches(VARIANT_ID, { message: VARIANT_ID_MESSAGE })
  lsVariantId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// Everything but the slug, which is immutable once a pack exists: it is the id
// a claim reads back off a checkout that may already be in flight.
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
      'Lemon Squeezy checkout link for this pack. Empty string clears it (takes it off sale).',
    example:
      'https://th-labs.lemonsqueezy.com/checkout/buy/158094fd-d3ba-4dfd-8e9d-f9d713036ea4',
  })
  @IsOptional()
  @IsString()
  @Matches(CHECKOUT_URL, { message: CHECKOUT_URL_MESSAGE })
  checkoutUrl?: string;

  @ApiPropertyOptional({
    description:
      'Lemon Squeezy variant id this link sells. Paid orders are matched on it.',
    example: '2203420',
  })
  @IsOptional()
  @IsString()
  @Matches(VARIANT_ID, { message: VARIANT_ID_MESSAGE })
  lsVariantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
