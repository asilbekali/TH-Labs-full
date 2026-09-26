import { PartialType } from '@nestjs/swagger';
import { CreatePriceTokenDto } from './create-price-token.dto';

export class UpdatePriceTokenDto extends PartialType(CreatePriceTokenDto) {}
