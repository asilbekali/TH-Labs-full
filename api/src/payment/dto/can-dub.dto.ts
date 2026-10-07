import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

// `durationSeconds` is a REAL number, not an integer.
//
// This was `@IsInt()`, and it is the whole reason every dub on the deployed
// Studio failed with 402. The browser rounds the duration it probes, so the
// Studio's own preflight passed — but the dubbing backend measures length with
// ffprobe, which returns e.g. 33.512, and posts that. class-validator rejected
// it with a 400, and backend/app/billing.py turned any 4xx from this API into
// "402 Payment Required". A user with a full wallet was told to pay.
//
// A duration is fractional by nature, so the DTO now says so. The cost is
// prorated per second anyway (see quality-cost.ts), so fractional input is
// meaningful rather than merely tolerated.
const MAX_DURATION_SECONDS = 24 * 60 * 60;

export class CanDubDto {
  @ApiProperty({
    example: 90.5,
    description: 'Source media length in seconds (fractional allowed)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DURATION_SECONDS)
  durationSeconds!: number;

  @ApiProperty({ example: 'balanced', enum: ['fast', 'balanced', 'studio'] })
  // Was a bare @IsString(), while CommitDubDto used @IsIn. An unknown quality
  // therefore passed the preflight (silently priced at the default) and then
  // 400'd at the charge — a gate that says yes and a charge that says no.
  @IsIn(['fast', 'balanced', 'studio'])
  quality!: string;

  // The Studio options a plan can lock (see plan-features.ts). Optional, so an
  // older caller that sends only the quality — the dubbing pipeline does — is
  // still checked on the quality and not refused for what it did not send.
  @ApiPropertyOptional({
    example: 'uz',
    description: 'Target language code — the Free plan dubs into Turkic ones',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}$/i)
  targetLang?: string;

  @ApiPropertyOptional({ enum: ['both', 'speaker', 'native'] })
  @IsOptional()
  @IsIn(['both', 'speaker', 'native'])
  voiceMode?: string;

  @ApiPropertyOptional({
    description: 'Clone the speaker voice (older callers; false = native mode)',
  })
  @IsOptional()
  @IsBoolean()
  voiceClone?: boolean;

  @ApiPropertyOptional({ description: 'Dub in an uploaded reference voice' })
  @IsOptional()
  @IsBoolean()
  referenceVoice?: boolean;

  @ApiPropertyOptional({ description: 'Keep background music & effects' })
  @IsOptional()
  @IsBoolean()
  keepBackground?: boolean;

  @ApiPropertyOptional({ description: 'Lip sync the speaker' })
  @IsOptional()
  @IsBoolean()
  lipSync?: boolean;
}

export type CanDubReason = 'INSUFFICIENT_CREDITS' | null;

export type PlanTierName = 'FREE' | 'PRO' | 'STUDIO';

export interface CanDubResult {
  /**
   * True when *some* dubbing can be paid for — not necessarily all of it.
   * False only when the balance cannot buy even one second, in which case the
   * caller must send the user to buy credits or a plan.
   */
  allowed: boolean;
  reason: CanDubReason;
  /** Credits the FULL requested duration would cost. */
  cost: number;
  balance: number;
  /** Seconds the caller asked about, echoed back. */
  durationSeconds: number;
  /**
   * Seconds that will actually be dubbed and charged — `durationSeconds` when
   * the balance covers the whole clip, otherwise the affordable prefix of it.
   */
  billableSeconds: number;
  /** Credits for `billableSeconds`. This is what commit-dub will charge. */
  billableCost: number;
  /** True when `billableSeconds < durationSeconds`: the dub will be cut short. */
  trimmed: boolean;
  /** Longest clip the current balance could dub at this quality, in seconds. */
  affordableSeconds: number;
  /** The tariff used, so a caller can explain the number it was given. */
  creditsPerMinute: number;
  /** The plan the request was checked against. */
  tier: PlanTierName;
}
