import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Min, MinLength } from 'class-validator';

// Committing a dub is the point where credits are actually charged (or the one
// free dub is consumed). Idempotent on `jobId` so a retried request never
// double-charges — see PaymentService.commitDub.
export class CommitDubDto {
  @ApiProperty({ example: 'job_abc123', description: 'Client-generated job id; the idempotency key' })
  @IsString()
  @MinLength(1)
  jobId!: string;

  @ApiProperty({ example: 90, description: 'Source media length in seconds' })
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @ApiProperty({ example: 'balanced', enum: ['fast', 'balanced', 'studio'] })
  @IsIn(['fast', 'balanced', 'studio'])
  quality!: string;
}

export interface CommitDubResult {
  jobId: string;
  charged: boolean; // true when credits were actually spent
  isFreeDub: boolean; // true when the one free dub was consumed
  cost: number;
  balance: number;
  idempotent: boolean; // true when this jobId was already committed
}
