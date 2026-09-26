import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FeedbackKind, FeedbackStatus } from '@prisma/client';

/**
 * Query for the panel's inbox. Paginated on the server, unlike
 * `/users/all-users-data` — feedback only ever grows, and the panel should not
 * have to hold every message ever sent in order to show the newest twenty.
 */
export class ListFeedbackDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ enum: FeedbackKind })
  @IsOptional()
  @IsEnum(FeedbackKind)
  kind?: FeedbackKind;

  @ApiPropertyOptional({
    description: 'Free text over the subject, message, name and email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
