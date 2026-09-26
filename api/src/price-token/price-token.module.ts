import { Module } from '@nestjs/common';
import { PriceTokenService } from './price-token.service';
import { PriceTokenController } from './price-token.controller';

@Module({
  controllers: [PriceTokenController],
  providers: [PriceTokenService],
})
export class PriceTokenModule {}
