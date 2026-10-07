import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 402 Payment Required — the caller is who they say they are, but cannot pay.
 *
 * Nest ships no PaymentRequiredException, and `commitDub` used to signal an
 * empty wallet with `BadRequestException('INSUFFICIENT_CREDITS')`. A 400 is the
 * wrong shape twice over: it says "your request was malformed" when the request
 * was fine, and it is indistinguishable from an actual validation failure — the
 * dubbing backend could not tell "you need credits" from "your payload is
 * wrong", so it treated both as a refusal to pay.
 *
 * The body carries a machine-readable `reason` plus the numbers a UI needs to
 * explain itself and offer the right next step, so no caller has to parse a
 * sentence.
 */
export class PaymentRequiredException extends HttpException {
  constructor(payload: {
    reason: 'INSUFFICIENT_CREDITS';
    message: string;
    cost: number;
    balance: number;
    affordableSeconds?: number;
  }) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        ...payload,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * 402 with `reason: 'PLAN_UPGRADE_REQUIRED'` — the dub asks for something the
 * caller's plan does not include (Studio quality on Free, lip sync, …).
 *
 * A 402 rather than a 403 on purpose: it IS a paywall, a real one, and the
 * dubbing pipeline (backend/app/billing.py) forwards a 402's message to the
 * user verbatim while turning any other 4xx into "try again later". A 403 here
 * would tell someone on Free that the service is down.
 */
export class PlanUpgradeRequiredException extends HttpException {
  constructor(payload: {
    message: string;
    feature: string;
    currentTier: string;
    requiredTier: string;
  }) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        reason: 'PLAN_UPGRADE_REQUIRED',
        ...payload,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
