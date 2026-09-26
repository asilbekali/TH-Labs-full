import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class CreditCheckoutQueryDto {
  // Shape-checked only: the catalog is a table an admin edits, so the set of
  // valid slugs is not knowable at compile time. Whether this one exists, is
  // active and has a Dodo product is settled by the service against the
  // database, which is the only place that can answer it correctly.
  @ApiProperty({ description: 'CreditPack slug', example: 'pack_240' })
  @Matches(/^[a-z0-9_-]{3,60}$/, { message: 'pack must be a valid pack slug' })
  pack!: string;
}
