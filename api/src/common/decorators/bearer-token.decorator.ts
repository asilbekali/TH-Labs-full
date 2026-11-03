import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The caller's raw access token, from `Authorization: Bearer …`.
 *
 * Used where this API calls the dubbing pipeline on the user's behalf. The
 * pipeline verifies the same token (same JWT_SECRET) and scopes jobs to its
 * owner, so forwarding it keeps "only your own dubs" enforced there too,
 * instead of this API holding a credential that could read anyone's.
 */
export const BearerToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const header = ctx.switchToHttp().getRequest<Request>()
      .headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  },
);
