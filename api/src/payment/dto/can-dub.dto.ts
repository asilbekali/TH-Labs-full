import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CanDubDto {
  @ApiProperty({ example: 90, description: 'Source media length in seconds' })
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @ApiProperty({ example: 'balanced', enum: ['fast', 'balanced', 'studio'] })
  @IsString()
  quality!: string;
}

export type CanDubReason =
  | 'FREE_DUB_LENGTH_EXCEEDED'
  | 'INSUFFICIENT_CREDITS'
  | null;

export interface CanDubResult {
  allowed: boolean;
  reason: CanDubReason;
  cost: number;
  isFreeDub: boolean;
  balance: number;
}
