import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    // SUPERADMIN satisfies every requirement. Without this the check is flat
    // membership, and a route that lists @Roles(ADMIN, USER) locks out the one
    // role that owns the system while admitting the least privileged one --
    // which is exactly what happened to GET/PATCH/DELETE /users/:id, leaving
    // the superadmin unable to change their own password through the API.
    // Encoding the hierarchy here rather than appending SUPERADMIN to every
    // decorator means the next route added cannot reintroduce the same gap.
    if (user?.role === Role.SUPERADMIN) return true;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    return true;
  }
}
