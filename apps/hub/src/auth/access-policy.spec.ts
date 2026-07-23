import { ForbiddenException } from '@nestjs/common';
import {
  assertCanChangeRole,
  assertCanDeleteTarget,
  assertCanManageTarget,
  isAssignableRole,
  isRegistryAdmin,
} from './access-policy';

describe('access policy', () => {
  it('recognizes registry administrators', () => {
    expect(isRegistryAdmin({ role: 'admin' } as never)).toBe(true);
    expect(isRegistryAdmin({ role: 'superuser' } as never)).toBe(true);
    expect(isRegistryAdmin({ role: 'user' } as never)).toBe(false);
  });

  it('only allows assignable non-superuser roles', () => {
    expect(isAssignableRole('user')).toBe(true);
    expect(isAssignableRole('admin')).toBe(true);
    expect(isAssignableRole('superuser')).toBe(false);
  });

  it('keeps managed and superuser accounts immutable', () => {
    expect(() =>
      assertCanManageTarget({ role: 'superuser', managed: true }),
    ).toThrow(ForbiddenException);
  });

  it('allows admins to delete users but not peer admins', () => {
    expect(() =>
      assertCanDeleteTarget(
        { role: 'admin' },
        { role: 'user', managed: false },
      ),
    ).not.toThrow();
    expect(() =>
      assertCanDeleteTarget(
        { role: 'admin' },
        { role: 'admin', managed: false },
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows admins to promote users but not modify peer admins', () => {
    expect(() =>
      assertCanChangeRole({ role: 'admin' }, { role: 'user', managed: false }),
    ).not.toThrow();
    expect(() =>
      assertCanChangeRole({ role: 'admin' }, { role: 'admin', managed: false }),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanChangeRole(
        { role: 'superuser' },
        { role: 'admin', managed: false },
      ),
    ).not.toThrow();
  });
});
