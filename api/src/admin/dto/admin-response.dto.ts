import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class AdminResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'jane.doe@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ enum: Role, example: Role.ADMIN })
  role!: Role;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminMessageResponseDto {
  @ApiProperty({ example: 'Admin #1 removed' })
  message!: string;
}
