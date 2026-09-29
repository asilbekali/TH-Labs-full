import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

// Committing a dub is the point where credits are actually charged. Idempotent
// on `jobId` so a retried request never double-charges — see
// PaymentService.commitDub.
//
// `durationSeconds` is the length ACTUALLY DUBBED, which after trimming is not
// the length of the file the user supplied. The caller trims first (see
// can-dub's `billableSeconds`) and then charges for what it kept.
//
// As in CanDubDto, this is a real number: it was `@IsInt()`, and ffprobe never
// reports whole seconds. See the note there for how that produced a 402.
const MAX_DURATION_SECONDS = 24 * 60 * 60;

export class CommitDubDto {
  @ApiProperty({
    example: 'job_abc123',
    description: 'Client-generated job id; the idempotency key',
  })
  @IsString()
  @MinLength(1)
  jobId!: string;

  @ApiProperty({
    example: 60.0,
    description: 'Seconds actually dubbed — after any trim (fractional allowed)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DURATION_SECONDS)
  durationSeconds!: number;

  @ApiProperty({ example: 'balanced', enum: ['fast', 'balanced', 'studio'] })
  @IsIn(['fast', 'balanced', 'studio'])
  quality!: string;
}

export interface CommitDubResult {
  jobId: string;
  charged: boolean; // true when credits were actually spent
  /** Seconds charged for. */
  durationSeconds: number;
  cost: number;
  balance: number;
  idempotent: boolean; // true when this jobId was already committed
}
