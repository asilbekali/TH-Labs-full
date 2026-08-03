import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

class AuthUserDto {
  @ApiProperty() id!: number;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() createdAt!: Date;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived token used to authorize requests' })
  accessToken!: string;

  @ApiProperty({
    type: AuthUserDto,
    description:
      'The refresh token is delivered as an httpOnly cookie, not in this body.',
  })
  user!: AuthUserDto;
}
