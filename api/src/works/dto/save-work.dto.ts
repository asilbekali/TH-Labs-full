import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class SaveWorkDto {
  @ApiProperty({
    description:
      "The Studio's record of the dub, stored as sent. Its `id` must match the job id in the path.",
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  work!: Record<string, unknown>;
}
