import { Injectable } from '@nestjs/common';
import { CreatePriceTokenDto } from './dto/create-price-token.dto';
import { UpdatePriceTokenDto } from './dto/update-price-token.dto';

@Injectable()
export class PriceTokenService {
  create(createPriceTokenDto: CreatePriceTokenDto) {
    return 'This action adds a new priceToken';
  }

  findAll() {
    return `This action returns all priceToken`;
  }

  findOne(id: number) {
    return `This action returns a #${id} priceToken`;
  }

  update(id: number, updatePriceTokenDto: UpdatePriceTokenDto) {
    return `This action updates a #${id} priceToken`;
  }

  remove(id: number) {
    return `This action removes a #${id} priceToken`;
  }
}
