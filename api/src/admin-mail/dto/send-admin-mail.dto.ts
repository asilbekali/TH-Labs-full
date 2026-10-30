import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AdminMailRecipientDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'Ada',
    description: 'Used for the greeting. Defaults to the part before the @.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class SendAdminMailDto {
  @ApiProperty({
    type: [AdminMailRecipientDto],
    description:
      'One email is sent per recipient — nobody sees anyone else on the list.',
  })
  @IsArray()
  @ArrayMinSize(1)
  // A hand-picked audience, not a newsletter. Gmail SMTP throttles well
  // before a few hundred messages, and the request is synchronous.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AdminMailRecipientDto)
  recipients: AdminMailRecipientDto[];

  @ApiProperty({ example: 'About your dub from yesterday' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    example: 'Thanks for the report — the sync fix shipped this morning.',
    description: 'Body copy. Blank lines become separate paragraphs.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  message: string;

  @ApiPropertyOptional({
    example: 'We fixed it',
    description: 'Headline inside the card. Defaults to a greeting.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  heading?: string;

  @ApiPropertyOptional({
    example: 42,
    description:
      'Set when this is a reply to a feedback message. Recorded in the ' +
      'activity log so the reply can be traced back to what it answered.',
  })
  @IsOptional()
  @IsInt()
  feedbackId?: number;
}
