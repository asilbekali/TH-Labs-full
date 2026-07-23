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
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import {
  AdminMessageResponseDto,
  AdminResponseDto,
} from './dto/admin-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

// Admin management panel: create/list/update/remove ADMIN & SUPERADMIN
// accounts. Only a SUPERADMIN may manage other admins — separate from
// UsersModule, which is self-service account management for regular users.
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires the SUPERADMIN role' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Create a new admin account' })
  @ApiCreatedResponse({ type: AdminResponseDto })
  @ApiConflictResponse({ description: 'Email is already in use' })
  create(@Body() createAdminDto: CreateAdminDto) {
    return this.adminService.create(createAdminDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all admin accounts' })
  @ApiOkResponse({ type: [AdminResponseDto] })
  findAll() {
    return this.adminService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admin account by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiOkResponse({ type: AdminResponseDto })
  @ApiNotFoundResponse({ description: 'Admin not found' })
  findOne(@Param('id') id: string) {
    return this.adminService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an admin account' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiOkResponse({ type: AdminResponseDto })
  @ApiNotFoundResponse({ description: 'Admin not found' })
  @ApiConflictResponse({ description: 'Email is already in use' })
  update(@Param('id') id: string, @Body() updateAdminDto: UpdateAdminDto) {
    return this.adminService.update(+id, updateAdminDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove an admin account' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiOkResponse({ type: AdminMessageResponseDto })
  @ApiNotFoundResponse({ description: 'Admin not found' })
  remove(@Param('id') id: string) {
    return this.adminService.remove(+id);
  }
}
