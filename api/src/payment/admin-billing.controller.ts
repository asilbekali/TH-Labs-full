import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { AdminBillingService } from './admin-billing.service';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  CreateCreditPackDto,
  UpdateCreditPackDto,
  UpdatePlanDto,
} from './dto/admin-billing.dto';

// The admin panel's billing surface: put a plan on sale by pasting its Lemon
// Squeezy checkout link and variant id, set how many credits it grants and
// what it costs, price the credit packs, and see at a glance why checkout is
// off.
//
// This is the whole of "managing credits" — changing PRO from 1,200 to 1,500 is
// a PATCH here and takes effect on the next request, with no deploy. `overview`
// also hands back the success URL every LS product should redirect to, so the
// buyer is brought straight back and credited in seconds.
//
// Staff only. ADMIN may read and edit — that is the day-to-day job of pricing
// and wiring up products. Deleting a credit pack is SUPERADMIN, matching
// price-token: a delete is the one action here that can strand a payment
// already in flight. (RolesGuard treats SUPERADMIN as satisfying every role,
// so it is not repeated on the ADMIN routes.)
@ApiTags('admin-billing')
@ApiBearerAuth()
@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Billing health: provider mode, what is wired up, what is missing',
  })
  @ApiOkResponse({
    description:
      'Read `canGrantCredits` first — false (no LEMONSQUEEZY_API_KEY) means a ' +
      'purchase can never be verified, so Buy is disabled. `successUrl` is the ' +
      'redirect every LS product should be configured with.',
  })
  overview() {
    return this.billing.getOverview();
  }

  // ── Plans ───────────────────────────────────────────────────────────────
  @Get('plans')
  @ApiOperation({
    summary: 'Every plan, active or not, with its Lemon Squeezy link and variant',
  })
  listPlans() {
    return this.billing.listPlans();
  }

  @Patch('plans/:id')
  @ApiOperation({
    summary:
      'Update a plan — paste its LS link + variant id, set credits, price, cycle length',
  })
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.billing.updatePlan(id, dto);
  }

  // ── Credit packs (one-time credit purchases) ────────────────────────────
  @Get('credit-packs')
  @ApiOperation({ summary: 'Every credit pack, active or not' })
  listCreditPacks() {
    return this.billing.listCreditPacks();
  }

  @Post('credit-packs')
  @ApiOperation({ summary: 'Create a credit pack' })
  createCreditPack(@Body() dto: CreateCreditPackDto) {
    return this.billing.createCreditPack(dto);
  }

  @Patch('credit-packs/:id')
  @ApiOperation({ summary: 'Update a credit pack (the slug is permanent)' })
  updateCreditPack(@Param('id') id: string, @Body() dto: UpdateCreditPackDto) {
    return this.billing.updateCreditPack(id, dto);
  }

  @Delete('credit-packs/:id')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Delete a credit pack (SUPERADMIN). Prefer active:false instead.',
  })
  deleteCreditPack(@Param('id') id: string) {
    return this.billing.deleteCreditPack(id);
  }
}
