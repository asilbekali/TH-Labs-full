import {
  Controller,
  ForbiddenException,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuthService } from '../auth/auth.service';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';

// create-user is public registration: creating a user account *is*
// registering it, so it takes only name/email/password and the role is
// always assigned automatically (defaults to USER). Everything else here
// is self-service (get/update/delete your own account). all-users is a
// public count, while all-users-data (full user list) is restricted to
// ADMIN and SUPERADMIN.
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get('all-users')
  findAll() {
    return this.usersService.findAll();
  }

  @Get('all-users-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get every user (ADMIN and SUPERADMIN only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findAllUsers() {
    return this.usersService.findAllUsers();
  }

  @Post('create-user')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async create(
    @Body() createUserDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const user = await this.usersService.create(createUserDto);
    return this.authService.issueTokens(user, res, req.headers['user-agent']);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.USER, Role.SUPERADMIN)
  findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    this.ensureSelfOrAdmin(currentUser, +id);
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.USER, Role.SUPERADMIN)
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    this.ensureSelfOrAdmin(currentUser, +id);
    return this.usersService.update(+id, updateUserDto);
  }

  // Deleting an account is destructive, so ADMIN (level 2) cannot do it to
  // somebody else -- only SUPERADMIN can. Every role may still delete its own
  // account, which is what keeps self-service account removal working.
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a user (own account, or any account as SUPERADMIN)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.USER, Role.SUPERADMIN)
  remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    this.ensureSelfOrSuperAdmin(currentUser, +id);
    return this.usersService.remove(+id);
  }

  // Role changes are SUPERADMIN-only: an ADMIN who could hand out roles could
  // promote itself to SUPERADMIN and erase the level-2 boundary entirely.
  @Patch(':id/role')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change a user role (SUPERADMIN only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  updateRole(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.usersService.updateRole(+id, updateRoleDto.role);
  }

  // Read/update: ADMIN and SUPERADMIN reach any account, everyone else only
  // their own. SUPERADMIN was missing here, which left the role that owns the
  // system unable to touch other accounts.
  private ensureSelfOrAdmin(currentUser: AuthenticatedUser, targetId: number) {
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERADMIN;

    if (!isAdmin && currentUser.id !== targetId) {
      throw new ForbiddenException('You can only access your own account');
    }
  }

  // Delete: only SUPERADMIN reaches somebody else's account.
  private ensureSelfOrSuperAdmin(
    currentUser: AuthenticatedUser,
    targetId: number,
  ) {
    if (currentUser.role !== Role.SUPERADMIN && currentUser.id !== targetId) {
      throw new ForbiddenException(
        'Only a SUPERADMIN can delete other accounts',
      );
    }
  }
}
