import { ApiProperty } from '@nestjs/swagger';

/**
 * One language, in the exact shape the Studio's picker consumes.
 *
 * The field names match backend/app/languages.py (the pipeline's own
 * dataclass), not the Prisma row: the frontend has one `Language` type for
 * both backends, so renaming anything here breaks the picker. `id`,
 * `sortOrder`, `active` and the timestamps are storage concerns and stay out
 * of the response.
 */
export class LanguageResponseDto {
  @ApiProperty({ example: 'uz', description: 'Short id used by the API and UI' })
  code!: string;

  @ApiProperty({ example: 'Uzbek', description: 'English display name' })
  name!: string;

  @ApiProperty({ example: 'Oʻzbekcha', description: 'Endonym' })
  native!: string;

  @ApiProperty({ example: '🇺🇿', description: 'Emoji flag' })
  flag!: string;

  @ApiProperty({ example: 'uz', description: 'Whisper (ASR) language code' })
  whisper!: string;

  @ApiProperty({ example: 'uzn_Latn', description: 'NLLB-200 FLORES-200 code' })
  nllb!: string;
}

export class LanguageListResponseDto {
  @ApiProperty({
    type: [LanguageResponseDto],
    description:
      'Active languages, in picker order. Wrapped in an object rather than ' +
      'returned as a bare array so the response can grow without a breaking change.',
  })
  languages!: LanguageResponseDto[];
}
