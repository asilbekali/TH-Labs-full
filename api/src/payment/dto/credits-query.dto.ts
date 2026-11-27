import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from './pagination-query.dto';

// ?page=&limit=&wallet= for GET /payments/credits. The ledger is listed one
// wallet at a time, because each wallet keeps its own running balance.
export class CreditsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['dub', 'realtime'], default: 'dub' })
  @IsOptional()
  @IsIn(['dub', 'realtime'])
  wallet?: 'dub' | 'realtime';
}
