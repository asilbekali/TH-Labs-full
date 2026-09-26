import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PriceTokenService } from './price-token.service';
import { CreatePriceTokenDto } from './dto/create-price-token.dto';
import { UpdatePriceTokenDto } from './dto/update-price-token.dto';

// Reads stay public -- the pricing table is what the landing page renders.
// Writes are staff-only: ADMIN may add and edit rows, but removing a price is
// destructive and belongs to SUPERADMIN alone.
@ApiTags('price-token')
@Controller('price-token')
export class PriceTokenController {
  constructor(private readonly priceTokenService: PriceTokenService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a token price (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  create(@Body() createPriceTokenDto: CreatePriceTokenDto) {
    return this.priceTokenService.create(createPriceTokenDto);
  }

  @Get()
  @ApiOperation({ summary: 'List token prices (public)' })
  findAll() {
    return this.priceTokenService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one token price (public)' })
  findOne(@Param('id') id: string) {
    return this.priceTokenService.findOne(+id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a token price (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  update(
    @Param('id') id: string,
    @Body() updatePriceTokenDto: UpdatePriceTokenDto,
  ) {
    return this.priceTokenService.update(+id, updatePriceTokenDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a token price (SUPERADMIN only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  remove(@Param('id') id: string) {
    return this.priceTokenService.remove(+id);
  }
}
