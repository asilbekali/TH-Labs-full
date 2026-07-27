import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateWaitListDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Name of the user joining the wait list',
  })
  @IsString()
  @MinLength(2)
  userName!: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address of the user joining the wait list',
  })
  @IsEmail()
  email!: string;
}
