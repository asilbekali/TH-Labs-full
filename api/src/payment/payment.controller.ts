import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PaymentService } from './payment.service';
import { LemonSqueezyService } from './lemonsqueezy.service';
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
  constructor(
    private readonly payments: PaymentService,
    private readonly ls: LemonSqueezyService,
  ) {}

  // ── Public ────────────────────────────────────────────────────────────
  @Get('plans')
  @ApiOperation({
    summary: 'List active plans, quality costs, and free-dub cap (public)',
  })
  getPlans() {
    return this.payments.getPlans();
  }

  @Get('credit-packs')
  @ApiOperation({
    summary: 'One-time credit packs and the per-minute tariff (public)',
  })
  getCreditPacks() {
    return this.payments.getCreditPacks();
  }

  // The Lemon Squeezy webhook: credits a purchase the instant LS marks it paid.
  //
  // Point LS at `https://<api-host>/v1/payments/webhook` (Settings → Webhooks)
  // with the events order_created, subscription_created,
  // subscription_payment_success, subscription_updated, subscription_cancelled
  // and subscription_expired, and put its signing secret in
  // LEMONSQUEEZY_WEBHOOK_SECRET. The event only names the account; the credits
  // come from reading the order back from LS — see PaymentService.handleWebhook.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lemon Squeezy webhook — signed with X-Signature (LS only)',
  })
  @ApiHeader({ name: 'X-Signature', required: true })
  @ApiUnauthorizedResponse({ description: 'Missing or wrong signature.' })
  @ApiServiceUnavailableResponse({
    description: 'Webhook not configured, or LS unreachable — LS retries.',
  })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
  ) {
    if (!this.ls.webhookConfigured) {
      throw new ServiceUnavailableException(
        'LEMONSQUEEZY_WEBHOOK_SECRET is not set on the API.',
      );
    }
    if (!req.rawBody || !this.ls.verifyWebhookSignature(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    return this.payments.handleWebhook(req.body);
  }

  // ── Authenticated ─────────────────────────────────────────────────────
  @Get('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "A plan's Lemon Squeezy checkout link, for this account (auth)",
  })
  @ApiOkResponse({
    description:
      '{ url } — send the browser here to pay. The link is the one an admin ' +
      "pasted into the panel, with the account's email prefilled: that email " +
      'is how the order is found again.',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: CheckoutQueryDto,
  ) {
    return this.payments.getCheckoutUrl(user.id, q.tier, q.cycle);
  }

  @Get('checkout/credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The same, for a one-time credit pack (auth)' })
  @ApiOkResponse({ description: '{ url } — send the browser here to pay' })
  creditCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: CreditCheckoutQueryDto,
  ) {
    return this.payments.getCreditCheckoutUrl(user.id, q.pack);
  }

  // The one endpoint that turns money into credits.
  //
  // Called by /plans/success when the buyer comes back from Lemon Squeezy (the
  // cron calls the same code for those who do not). It takes no input at all:
  // it asks LS for the paid orders filed under this account's email and
  // credits each new one. Safe to call any number of times — every order pays
  // out once, enforced by a UNIQUE index. See PaymentService.claimOrders.
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Credit this account's paid Lemon Squeezy orders (auth)",
  })
  @ApiOkResponse({
    description:
      '{ claimed, granted[], creditsGranted, balance, pending, unmatched, ' +
      'recent[], subscription }. `claimed: false` with `pending: true` means ' +
      'LS is still processing — ask again in a few seconds. `recent` lists ' +
      'purchases credited in the last hour, including by the cron.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Lemon Squeezy is not configured or not reachable. Retry.',
  })
  claim(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.claimOrders(user.id);
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
  @ApiOperation({
    summary: 'Stop this plan renewing here — keeps unspent credits (auth)',
  })
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.cancelSubscription(user.id);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated payment history (auth)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: PaginationQueryDto,
  ) {
    return this.payments.getHistory(user.id, q.page, q.limit);
  }

  @Get('credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Credit balance + paginated ledger (auth)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  credits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: PaginationQueryDto,
  ) {
    return this.payments.getCredits(user.id, q.page, q.limit);
  }

  @Get('credits/reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Dev: report drift between cached balance and ledger (auth)',
  })
  reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.reconcile(user.id);
  }

  @Get('entitlements')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "This account's plan tier and the Studio features it unlocks (auth)",
  })
  @ApiOkResponse({
    description:
      '{ tier, features: { qualities[], voiceClone, referenceVoice, ' +
      'keepBackground, lipSync }, allTiers }. can-dub and commit-dub enforce ' +
      'the same table and answer 402 `PLAN_UPGRADE_REQUIRED` for a locked feature.',
  })
  entitlements(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.getEntitlements(user.id);
  }

  @Post('can-dub')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Preflight gate check — read-only, charges nothing (auth)',
  })
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
