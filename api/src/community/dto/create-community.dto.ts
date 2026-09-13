import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateCommunityDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Name of the person joining the community',
  })
  @IsString()
  @MinLength(2)
  userName!: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address of the person joining the community',
  })
  @IsEmail()
  email!: string;
}
