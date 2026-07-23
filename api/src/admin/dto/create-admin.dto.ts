import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({
    example: 'Jane Doe',
    description: 'Full name of the admin',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'Email address of the admin',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    description: 'Admin password',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    enum: Role,
    example: Role.ADMIN,
    default: Role.ADMIN,
    required: false,
    description: 'Role to assign — ADMIN or SUPERADMIN (defaults to ADMIN)',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
