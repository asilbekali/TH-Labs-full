import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const PRESENCE_SITES = ['landing', 'app'] as const;
export type PresenceSite = (typeof PRESENCE_SITES)[number];

export class HeartbeatDto {
  @ApiProperty({
    description: 'Random per-browser id kept in localStorage. Not a user id.',
    example: 'v_3f9c2a7e1b',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  visitorId: string;

  @ApiProperty({ enum: PRESENCE_SITES })
  @IsIn(PRESENCE_SITES)
  site: PresenceSite;

  @ApiProperty({ example: '/studio', description: 'Path only — no query.' })
  @IsString()
  @MaxLength(200)
  path: string;

  @ApiPropertyOptional({
    example: 'Dubbing interview.mp4 into Uzbek',
    description: 'What the page says the person is doing, when it knows.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  doing?: string;

  @ApiPropertyOptional({
    description: 'True on a navigation, false/absent on a keep-alive beat.',
  })
  @IsOptional()
  @IsBoolean()
  pageview?: boolean;
}
