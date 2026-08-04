import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthService, REFRESH_COOKIE } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ExchangeHandoffDto, HandoffCodeDto } from './dto/handoff.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Access tokens live in the response body (client keeps them in memory);
// the refresh token is an httpOnly cookie the browser sends back automatically.
// Registration lives at POST /users/create-user — creating a user account is
// registering it, there is no separate "register" step here.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    return this.authService.login(dto, res, req.headers['user-agent']);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and return a new access token',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    return this.authService.refresh(raw, res, req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke the refresh token' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    return this.authService.logout(raw, res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
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
    summary: 'Redeem a handoff code for an access token + refresh cookie',
    description:
      'Public by necessity — the code IS the credential. Valid for 60s and ' +
      'exactly one redemption, so a copy recovered from a log is already ' +
      'dead. Sets the same rotated httpOnly refresh cookie a login would, so ' +
      "the caller must use credentials:'include' or it cannot refresh later.",
  })
  @ApiOkResponse({ type: AuthResponseDto })
  exchangeHandoff(
    @Body() dto: ExchangeHandoffDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    return this.authService.exchangeHandoffCode(
      dto.code,
      res,
      req.headers['user-agent'],
    );
  }
}
