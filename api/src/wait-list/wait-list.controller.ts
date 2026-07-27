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
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WaitListService } from './wait-list.service';
import { CreateWaitListDto } from './dto/create-wait-list.dto';
import { UpdateWaitListDto } from './dto/update-wait-list.dto';

@Controller('wait-list')
export class WaitListController {
  constructor(private readonly waitListService: WaitListService) {}

  // Public: anyone can join the wait list, no access token required.
  @Post()
  @ApiOperation({ summary: 'Join the wait list (public)' })
  create(@Body() createWaitListDto: CreateWaitListDto) {
    return this.waitListService.create(createWaitListDto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all wait list entries (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findAll() {
    return this.waitListService.findAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one wait list entry (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findOne(@Param('id') id: string) {
    return this.waitListService.findOne(+id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a wait list entry (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  update(@Param('id') id: string, @Body() updateWaitListDto: UpdateWaitListDto) {
    return this.waitListService.update(+id, updateWaitListDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a wait list entry (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  remove(@Param('id') id: string) {
    return this.waitListService.remove(+id);
  }
}
