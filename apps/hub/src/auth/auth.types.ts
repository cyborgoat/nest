export type { HubUser as AuthUser, UserRole } from '@nest/shared';
import type { HubUser as AuthUser } from '@nest/shared';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
