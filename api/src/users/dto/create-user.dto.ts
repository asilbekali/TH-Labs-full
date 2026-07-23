import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the user',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address of the user',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    description: 'User password',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;
}
