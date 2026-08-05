import { ForbiddenException } from '@nestjs/common';
import type { AuthUser, UserRole } from './auth.types';

export function isRegistryAdmin(user?: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'superuser';
}

export function isAssignableRole(role: UserRole): role is 'user' | 'admin' {
  return role === 'user' || role === 'admin';
}

export function assertMutableAccount(user: Pick<AuthUser, 'managed'>): void {
  if (user.managed) {
    throw new ForbiddenException(
      'The environment-managed superuser account cannot be changed',
    );
  }
}

export function assertCanManageTarget(target: {
  role: UserRole;
  managed: boolean;
}): void {
  if (target.managed || target.role === 'superuser') {
    throw new ForbiddenException(
      'The environment-managed superuser cannot be changed',
    );
  }
}

export function assertCanChangeRole(
  actor: Pick<AuthUser, 'role'>,
  target: { role: UserRole; managed: boolean },
): void {
  assertCanManageTarget(target);
  if (actor.role === 'admin' && target.role !== 'user') {
    throw new ForbiddenException(
      'Admins may promote regular users but cannot change peer administrators',
    );
  }
}

export function assertCanDeleteTarget(
  actor: Pick<AuthUser, 'role'>,
  target: { role: UserRole; managed: boolean },
): void {
  assertCanManageTarget(target);
  if (actor.role === 'admin' && target.role !== 'user') {
    throw new ForbiddenException('Admins may only remove regular users');
  }
}

export function assertCanResetPassword(
  actor: Pick<AuthUser, 'role'>,
  target: { role: UserRole; managed: boolean },
): void {
  assertCanManageTarget(target);
  if (actor.role === 'admin' && target.role !== 'user') {
    throw new ForbiddenException(
      'Admins may only reset passwords for regular users',
    );
  }
}
