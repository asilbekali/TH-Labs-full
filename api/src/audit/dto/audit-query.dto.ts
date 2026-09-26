import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type StatsBucket = 'second' | 'minute' | 'hour' | 'day';

// Query strings arrive as strings; 'false' is truthy, so a plain Boolean()
// would turn ?success=false into true and silently invert the filter.
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : undefined;

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Only this user id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorId?: number;

  @ApiPropertyOptional({ description: 'Substring match on the actor email' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorEmail?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description:
      'Action name or prefix — "billing" matches every billing.* action',
    example: 'billing.plan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'POST' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @ApiPropertyOptional({
    description: 'What was acted on: user, admin, plan, creditPack, language',
    example: 'user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Exact target id — every action against one account or row',
    example: '42',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetId?: string;

  @ApiPropertyOptional({
    description:
      "Substring match on the target's label, e.g. the affected account's email",
    example: 'ada@example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetLabel?: string;

  @ApiPropertyOptional({ description: 'false lists only failed requests' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601 lower bound (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 upper bound (inclusive)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Free text over summary, path, action, and BOTH the actor and target emails',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

export class AuditStatsDto {
  @ApiPropertyOptional({
    enum: ['second', 'minute', 'hour', 'day'],
    default: 'hour',
    description: 'Width of one point in the returned series',
  })
  @IsOptional()
  @IsEnum(['second', 'minute', 'hour', 'day'])
  bucket?: StatsBucket = 'hour';

  @ApiPropertyOptional({ description: 'ISO 8601; defaults to 24h before `to`' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601; defaults to now' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Action name or prefix' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorId?: number;
}
