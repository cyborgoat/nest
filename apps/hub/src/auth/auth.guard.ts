import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(protected readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.token(request);
    if (!token) throw new UnauthorizedException('Authentication required');
    request.authUser = this.auth.authenticate(token);
    return true;
  }
  protected token(request: Request) {
    const value = request.headers.authorization;
    if (value?.startsWith('Bearer ') && value.length > 7) return value.slice(7);
    const raw = request.headers.cookie ?? '';
    return raw
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('nest_access='))
      ?.slice('nest_access='.length);
  }
}

@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.token(request);
    if (token) request.authUser = this.auth.authenticate(token);
    return true;
  }
  constructor(authService: AuthService) {
    super(authService);
  }
}

@Injectable()
export class RegistryAdminGuard extends AuthGuard {
  canActivate(context: ExecutionContext) {
    super.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();
    if (!['admin', 'superuser'].includes(request.authUser?.role ?? ''))
      throw new ForbiddenException('Administrator access required');
    return true;
  }
}
