import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Request body for POST /auth/handoff/exchange. */
export class ExchangeHandoffDto {
  @ApiProperty({
    description:
      'The single-use code delivered as ?code= on the redirect to the Studio',
  })
  @IsString()
  // 32 random bytes render as 43 base64url chars. Bounding the length keeps
  // absurd payloads from reaching the hash, and costs nothing — a wrong-length
  // code could never match a stored hash anyway.
  @Length(20, 128)
  code!: string;
}

/** Response body for POST /auth/handoff. */
export class HandoffCodeDto {
  @ApiProperty({
    description:
      'Single-use code. Redeem via POST /auth/handoff/exchange; valid once.',
  })
  code!: string;

  @ApiProperty({ description: 'Seconds until the code expires', example: 60 })
  expiresIn!: number;
}
