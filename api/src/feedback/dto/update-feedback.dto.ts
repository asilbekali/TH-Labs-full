import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackStatus } from '@prisma/client';

/**
 * Triage, not editing.
 *
 * An ADMIN moves the status and attaches a private note; they do NOT get to
 * rewrite what somebody sent us. That is why `message`, `email`, `name`,
 * `kind` and `rating` are absent here — with the global ValidationPipe running
 * `forbidNonWhitelisted`, sending one is a 400 rather than a silent no-op.
 */
export class UpdateFeedbackDto {
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({
    example: 'Reproduced on an 11-minute clip. Filed as PIPE-204.',
    description: 'Private staff note. Never shown to the sender.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
