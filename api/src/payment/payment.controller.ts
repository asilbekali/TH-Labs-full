import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { PaymentService } from './payment.service';
import { DodoService } from './dodo.service';
import { DodoWebhookHandler } from './webhook.handler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CheckoutQueryDto } from './dto/checkout-query.dto';
import { CreditCheckoutQueryDto } from './dto/credit-checkout-query.dto';
import { CanDubDto } from './dto/can-dub.dto';
import { CommitDubDto } from './dto/commit-dub.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly payments: PaymentService,
    private readonly dodo: DodoService,
    private readonly webhook: DodoWebhookHandler,
    private readonly prisma: PrismaService,
  ) {}

  // ── Public ────────────────────────────────────────────────────────────
  @Get('plans')
  @ApiOperation({ summary: 'List active plans, quality costs, and free-dub cap (public)' })
  getPlans() {
    return this.payments.getPlans();
  }

  @Get('credit-packs')
  @ApiOperation({ summary: 'One-time credit packs and the per-minute tariff (public)' })
  getCreditPacks() {
    return this.payments.getCreditPacks();
  }

  // Dodo Payments posts here. Public, but every payload is signature-verified
  // and idempotency-guarded before any credits move. Needs the raw request
  // body, enabled via `rawBody: true` in main.ts.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dodo Payments webhook (public, raw body, signature-verified)',
  })
  async handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException('Missing raw request body for webhook.');
    }

    // 1. Verify — anything that doesn't verify is a 400 and is never
    //    processed. The Standard Webhooks signature covers all three
    //    webhook-* headers plus the exact bytes, so we hand it the raw body.
    const event = this.dodo.constructEvent(raw, req.headers);

    // 2. Idempotency, before any business logic. `webhook-id` is stable across
    //    the provider's retries of one event, and the unique constraint on it
    //    — not an `if` check — is what makes this safe under concurrency.
    const eventId = String(req.headers['webhook-id']);
    try {
      await this.prisma.webhookEvent.create({
        data: { eventId, type: event.type },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`Duplicate webhook ${eventId} ignored`);
        return { received: true, duplicate: true };
      }
      throw err;
    }

    // 3. Dispatch. If it throws, drop the idempotency marker so the retry
    //    reprocesses the event, and surface a 500.
    try {
      await this.webhook.dispatch(event);
    } catch (err) {
      await this.prisma.webhookEvent
        .delete({ where: { eventId } })
        .catch(() => undefined);
      this.logger.error(
        `Webhook ${event.type} (${eventId}) failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
      throw err;
    }

    return { received: true };
  }

  // ── Authenticated ─────────────────────────────────────────────────────
  @Get('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a Dodo Payments checkout URL for a plan (auth)' })
  @ApiOkResponse({ description: '{ url } — redirect the user here to pay' })
  checkout(@CurrentUser() user: AuthenticatedUser, @Query() q: CheckoutQueryDto) {
    return this.payments.getCheckoutUrl(user.id, q.tier, q.cycle);
  }

  @Get('checkout/credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Checkout URL for a one-time credit pack (auth)' })
  @ApiOkResponse({ description: '{ url } — redirect the user here to pay' })
  creditCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: CreditCheckoutQueryDto,
  ) {
    return this.payments.getCreditCheckoutUrl(user.id, q.pack);
  }

  @Get('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Link into Dodo's customer portal (auth)" })
  portal(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.getCustomerPortalUrl(user.id);
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Current user's subscription (auth)" })
  subscription(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.getSubscription(user.id);
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel at period end — keeps unspent credits (auth)' })
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.cancelSubscription(user.id);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated payment history (auth)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  history(@CurrentUser() user: AuthenticatedUser, @Query() q: PaginationQueryDto) {
    return this.payments.getHistory(user.id, q.page, q.limit);
  }

  @Get('credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Credit balance + paginated ledger (auth)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  credits(@CurrentUser() user: AuthenticatedUser, @Query() q: PaginationQueryDto) {
    return this.payments.getCredits(user.id, q.page, q.limit);
  }

  @Get('credits/reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dev: report drift between cached balance and ledger (auth)' })
  reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.reconcile(user.id);
  }

  @Post('can-dub')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preflight gate check — read-only, charges nothing (auth)' })
  canDub(@CurrentUser() user: AuthenticatedUser, @Body() dto: CanDubDto) {
    return this.payments.canDub(user.id, dto);
  }

  @Post('commit-dub')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Charge the dub — idempotent on jobId (auth)' })
  commitDub(@CurrentUser() user: AuthenticatedUser, @Body() dto: CommitDubDto) {
    return this.payments.commitDub(user.id, dto);
  }
}
