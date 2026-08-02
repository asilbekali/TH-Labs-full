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
import { ExchangeHandoffDto, HandoffCodeDto } from './dto/handoff.dto';
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

  // ── Cross-origin handoff ────────────────────────────────────────────────
  // The landing page and the Studio are on different origins, so a session
  // cannot follow the user in a cookie. These two endpoints move it without
  // ever putting a token in a URL: mint here, redeem there.

  @Post('handoff')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Mint a single-use code that carries this session to the Studio',
    description:
      'Called server-to-server by the landing page with the access token it ' +
      'just issued. The code goes in the redirect URL; the tokens do not.',
  })
  @ApiOkResponse({ type: HandoffCodeDto })
  handoff(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.createHandoffCode(user.id);
  }

  @Post('handoff/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redeem a handoff code for a token pair',
    description:
      'Public by necessity — the code IS the credential. Valid for 60s and ' +
      'exactly one redemption, so a copy recovered from a log is already dead.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  exchangeHandoff(@Body() dto: ExchangeHandoffDto) {
    return this.authService.exchangeHandoffCode(dto.code);
  }
}
