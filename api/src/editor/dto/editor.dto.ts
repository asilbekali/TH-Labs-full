import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiPropertyOptional({ example: 'Cartoon episode 1' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Cartoon episode 1' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    description:
      'The whole timeline. Checked clip by clip against the project files ' +
      '(src/editor/timeline.ts) and stored normalised.',
    type: 'array',
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  tracks?: unknown[];
}

export class ImportAssetDto {
  @ApiPropertyOptional({
    description:
      'A finished text-to-speech task (POST /api/tts on the pipeline)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  ttsTaskId?: string;

  @ApiPropertyOptional({ description: 'A finished dub, to edit its video' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  jobId?: string;

  @ApiPropertyOptional({ description: 'Name to show in the media bin' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'The script, kept with a speech clip' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;
}

export class SubtitlesDto {
  @ApiPropertyOptional({
    example: 'uz',
    description: "The spoken language, or 'auto' to detect it",
  })
  @IsOptional()
  @IsString()
  @Matches(/^(auto|[a-z]{2,3})$/)
  language?: string;
}
