import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtRefreshGuard } from '../common/guards/jwt-refresh.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Registration lives at POST /users/create-user — creating a user account
// is registering it, there's no separate "register" step.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtRefreshGuard)
  @ApiOperation({
    summary: 'Exchange a valid refresh token for a new token pair',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.refresh(user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout and revoke the refresh token' })
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user.id);
  }
}
