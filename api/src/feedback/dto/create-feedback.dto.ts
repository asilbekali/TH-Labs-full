import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FeedbackKind } from '@prisma/client';

export class CreateFeedbackDto {
  @ApiPropertyOptional({
    example: 'Ada Lovelace',
    description:
      'Who is writing. OPTIONAL for a signed-in caller: the server takes the ' +
      'name from the account on the bearer token and ignores whatever is sent ' +
      'here, so the app only has to post a message. Required for an anonymous ' +
      'caller, who has no account to read it from.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    example: 'ada@example.com',
    description:
      'Where to reply. OPTIONAL for a signed-in caller, for the same reason ' +
      'as `name` — the token is the authority on who is writing. Required for ' +
      'an anonymous caller.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'Uzbek dub drifts out of sync after ~3 minutes',
    description: 'Optional one-line subject.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  subject?: string;

  @ApiProperty({
    example:
      'The Uzbek voice starts fine but by minute three it is about a second ' +
      'ahead of the lips. Balanced quality, 8 minute clip.',
    description: 'The message itself.',
  })
  @IsString()
  @MinLength(10)
  // Capped so a paste of an entire log file cannot fill the table. 4000 is
  // generous for prose and still small enough to render in the panel's feed.
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({
    enum: FeedbackKind,
    default: FeedbackKind.GENERAL,
    description: 'What kind of message this is, so the panel can triage it.',
  })
  @IsOptional()
  @IsEnum(FeedbackKind)
  kind?: FeedbackKind;

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'Optional 1-5 rating. Deliberately not required — demanding a star ' +
      'rating to file a bug report is how you stop getting bug reports.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    example: '/studio',
    description: 'Which page it was sent from. Diagnostics, not analytics.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pagePath?: string;
}
