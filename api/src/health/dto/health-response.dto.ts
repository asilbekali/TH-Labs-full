import { ApiProperty } from '@nestjs/swagger';

/** One pipeline stage, mirrored from the dubbing service's own health payload. */
export class StageInfoDto {
  @ApiProperty({ example: 'asr' })
  key!: string;

  @ApiProperty({ example: 'Transcribe' })
  label!: string;

  @ApiProperty({ example: 'whisper-large-v3' })
  engine!: string;

  @ApiProperty({ example: 'real', enum: ['real', 'simulation'] })
  mode!: 'real' | 'simulation';

  @ApiProperty({ example: 'CUDA, fp16' })
  detail!: string;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'TH-LABS API' })
  app!: string;

  @ApiProperty({ example: '1.0.0' })
  version!: string;

  /**
   * The pipeline's own mode when it answers, `degraded` when it does not.
   * Never guessed: a value here always came from a live pipeline response.
   */
  @ApiProperty({
    example: 'real',
    description:
      "The dubbing pipeline's reported mode, or 'degraded' when it is unreachable",
  })
  mode!: string;

  @ApiProperty({
    example: true,
    description: 'Whether the pipeline has ffmpeg. False when it is unreachable.',
  })
  ffmpeg!: boolean;

  @ApiProperty({
    type: [StageInfoDto],
    description:
      'Live stage/engine status from the pipeline. Empty when it is unreachable — ' +
      'an empty list means "unknown", not "no stages".',
  })
  stages!: StageInfoDto[];

  @ApiProperty({
    example: 'up',
    enum: ['up', 'down'],
    description: 'Whether this API can reach its own database',
  })
  database!: 'up' | 'down';

  @ApiProperty({
    example: 'up',
    enum: ['up', 'down', 'not_configured'],
    description:
      'Whether the dubbing pipeline answered. `not_configured` means DUB_API_URL is unset.',
  })
  pipeline!: 'up' | 'down' | 'not_configured';
}
