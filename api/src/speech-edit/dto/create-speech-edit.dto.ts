import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LineEditDto {
  @ApiProperty({ example: 3, description: 'The segment id from the dub' })
  @IsInt()
  @Min(0)
  id!: number;

  @ApiPropertyOptional({
    example: 'Salom, dunyo!',
    description:
      'New wording. Empty clears the line, so nothing is spoken there.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  target_text?: string;

  @ApiPropertyOptional({ example: 4.2, description: 'New start, seconds' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  start?: number;

  @ApiPropertyOptional({ example: 6.8, description: 'New end, seconds' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  end?: number;
}

export class CreateSpeechEditDto {
  @ApiProperty({ example: '6787c3cc201d', description: "The dub's job id" })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  jobId!: string;

  @ApiProperty({ type: [LineEditDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineEditDto)
  segments!: LineEditDto[];
}
