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
