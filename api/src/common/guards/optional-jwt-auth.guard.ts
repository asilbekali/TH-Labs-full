import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT auth that does not refuse an anonymous caller.
 *
 * For routes that are public but behave better when they know who you are.
 * `POST /feedback` is the case it was written for: the Home page's feedback box
 * is reachable while signed out, but when a token IS present the message should
 * be stamped with the account rather than arriving from nobody.
 *
 * The whole trick is `handleRequest`: passport's default throws on a missing or
 * invalid token, which is exactly what makes AuthGuard a gate. Returning
 * `undefined` instead leaves `req.user` unset and lets the handler run — so a
 * route using this guard MUST treat the user as optional. An expired or forged
 * token is therefore indistinguishable from no token at all, which is the
 * intended behaviour here (a bad token must not cost someone their bug report)
 * and precisely why this guard must never be used to protect anything.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | undefined {
    return user || undefined;
  }
}
