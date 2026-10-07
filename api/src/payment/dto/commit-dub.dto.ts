import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { CanDubDto } from './can-dub.dto';

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
// Extends CanDubDto for `quality` and the plan-locked options, so the charge
// enforces the same plan rules as the preflight.
export class CommitDubDto extends CanDubDto {
  @ApiProperty({
    example: 'job_abc123',
    description: 'Client-generated job id; the idempotency key',
  })
  @IsString()
  @MinLength(1)
  jobId!: string;

  // durationSeconds and quality come from CanDubDto (same validation). Here
  // durationSeconds is the length ACTUALLY DUBBED, after any trim.
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
