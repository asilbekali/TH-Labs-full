import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class StartSessionDto {
  @ApiProperty({
    example: 'uz',
    description:
      'Target language, as an app catalog code (GET /v1/languages). The ' +
      'source language is detected by the model.',
  })
  @IsString()
  @Length(2, 10)
  targetLanguage!: string;
}
