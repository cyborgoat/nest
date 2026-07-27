import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.service';
import type { AuthUser, UserRole } from './auth.types';
import { HubRuntimeConfig } from '../hub.config';
import { assertMutableAccount } from './access-policy';
import { hashPassword, verifyPassword } from './password';

const LOGIN_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/;
const now = () => new Date().toISOString();
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

type UserRow = {
  uuid: string;
  login_id: string;
  name: string;
  password_hash: string;
  role: UserRole;
  managed_by_env: number;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly loginAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  constructor(
    private readonly database: DatabaseService,
    private readonly config: HubRuntimeConfig,
  ) {}

  async onModuleInit() {
    const id = this.config.value.superuserId;
    const password = this.config.value.superuserPassword ?? '';
    const managed = this.database.db
      .prepare('SELECT * FROM users WHERE managed_by_env = 1 LIMIT 1')
      .get() as UserRow | undefined;
    if (managed) {
      const configuredIdMatches = !id || id === managed.login_id;
      if (!configuredIdMatches) {
        this.logger.warn(
          `SUPERUSER_ID=${id} does not match locked superuser ${managed.login_id}; keeping the locked account`,
        );
      }
      const passwordChanged =
        configuredIdMatches &&
        Boolean(password) &&
        !(await verifyPassword(managed.password_hash, password));
      const passwordHash = passwordChanged
        ? await hashPassword(password)
        : managed.password_hash;
      this.database.db.transaction(() => {
        this.database.db
          .prepare(
            "UPDATE users SET role = 'superuser', password_hash = ?, updated_at = ? WHERE uuid = ?",
          )
          .run(passwordHash, now(), managed.uuid);
        if (passwordChanged) {
          this.database.db
            .prepare(
              'UPDATE auth_sessions SET revoked_at = ? WHERE user_uuid = ? AND revoked_at IS NULL',
            )
            .run(now(), managed.uuid);
        }
      })();
      return;
    }

    let target: UserRow | undefined;
    if (id) target = this.userByLogin(id);
    if (!target && !id) {
      const legacy = this.database.db
        .prepare(
          "SELECT * FROM users WHERE role = 'superuser' ORDER BY created_at",
        )
        .all() as UserRow[];
      if (legacy.length === 1) target = legacy[0];
      else if (legacy.length > 1)
        throw new Error(
          'Multiple legacy superusers exist; configure SUPERUSER_ID to select the locked account',
        );
    }
    if (!target && id) {
      if (!password)
        throw new Error(
          'SUPERUSER_PASSWORD is required to create the environment-managed superuser',
        );
      const created = await this.createUser(
        id,
        password,
        this.config.value.superuserName,
        'superuser',
      );
      target = this.userByLogin(created.id);
    }
    if (!target) return;

    const configuredName = this.config.value.superuserName;
    const passwordHash = password
      ? await hashPassword(password)
      : target.password_hash;
    this.database.db.transaction(() => {
      this.database.db
        .prepare(
          "UPDATE users SET role = 'admin', updated_at = ? WHERE role = 'superuser' AND uuid <> ?",
        )
        .run(now(), target.uuid);
      this.database.db
        .prepare(
          `UPDATE users SET role = 'superuser', managed_by_env = 1, name = ?, password_hash = ?, updated_at = ? WHERE uuid = ?`,
        )
        .run(configuredName || target.name, passwordHash, now(), target.uuid);
    })();
  }

  async register(id: string, password: string, name: string) {
    return this.issue(await this.createUser(id, password, name, 'user'));
  }

  async login(id: string, password: string) {
    const loginId = id.trim().toLowerCase();
    const attempt = this.loginAttempts.get(loginId);
    if (attempt && attempt.count >= 5 && attempt.resetAt > Date.now()) {
      throw new HttpException('Too many login attempts. Try again later.', 429);
    }
    const user = this.userByLogin(loginId);
    if (!user || !(await verifyPassword(user.password_hash, password))) {
      const active =
        attempt && attempt.resetAt > Date.now()
          ? attempt
          : { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
      this.loginAttempts.set(loginId, { ...active, count: active.count + 1 });
      throw new UnauthorizedException('Invalid account ID or password');
    }
    this.loginAttempts.delete(loginId);
    return this.issue(this.publicUser(user));
  }

  updateProfile(user: AuthUser, name: string): AuthUser {
    assertMutableAccount(user);
    const displayName = name.trim();
    if (!displayName) throw new ConflictException('Name is required');
    if (displayName.length > 100)
      throw new ConflictException('Name must contain at most 100 characters');
    const timestamp = now();
    this.database.db
      .prepare('UPDATE users SET name = ?, updated_at = ? WHERE uuid = ?')
      .run(displayName, timestamp, user.uuid);
    return { ...user, name: displayName };
  }

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
  ) {
    assertMutableAccount(user);
    const row = this.database.db
      .prepare('SELECT * FROM users WHERE uuid = ?')
      .get(user.uuid) as UserRow | undefined;
    if (!row || !(await verifyPassword(row.password_hash, currentPassword)))
      throw new UnauthorizedException('Current password is incorrect');
    this.validatePassword(newPassword);
    if (currentPassword === newPassword)
      throw new ConflictException(
        'New password must be different from the current password',
      );
    const passwordHash = await hashPassword(newPassword);
    this.database.db.transaction(() => {
      this.database.db
        .prepare(
          'UPDATE users SET password_hash = ?, updated_at = ? WHERE uuid = ?',
        )
        .run(passwordHash, now(), user.uuid);
      this.database.db
        .prepare(
          'UPDATE auth_sessions SET revoked_at = ? WHERE user_uuid = ? AND revoked_at IS NULL',
        )
        .run(now(), user.uuid);
    })();
    return this.issue(this.publicUser(row));
  }

  refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const row = this.database.db
      .prepare(
        `
      SELECT s.id AS session_id, s.expires_at, u.* FROM auth_sessions s
      JOIN users u ON u.uuid = s.user_uuid
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
    `,
      )
      .get(tokenHash) as
      (UserRow & { session_id: string; expires_at: string }) | undefined;
    if (!row || new Date(row.expires_at) <= new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    this.database.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?')
      .run(now(), row.session_id);
    return this.issue(this.publicUser(row));
  }

  logout(refreshToken: string) {
    this.database.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?')
      .run(now(), hashToken(refreshToken));
    return { success: true };
  }

  authenticate(accessToken: string): AuthUser {
    try {
      const payload = jwt.verify(accessToken, this.jwtSecret()) as {
        sub: string;
      };
      const row = this.database.db
        .prepare('SELECT * FROM users WHERE uuid = ?')
        .get(payload.sub) as UserRow | undefined;
      if (!row) throw new Error('missing user');
      return this.publicUser(row);
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }

  private async createUser(
    id: string,
    password: string,
    name: string,
    role: UserRole,
  ): Promise<AuthUser> {
    const loginId = id.trim().toLowerCase();
    const displayName = name.trim();
    if (!LOGIN_ID_RE.test(loginId))
      throw new ConflictException(
        'Account ID must be 3-32 lowercase letters, numbers, underscores, or hyphens',
      );
    if (!displayName) throw new ConflictException('Name is required');
    this.validatePassword(password);
    if (this.userByLogin(loginId))
      throw new ConflictException('Account ID is already registered');
    const user: AuthUser = {
      uuid: randomUUID(),
      id: loginId,
      name: displayName,
      role,
      managed: false,
    };
    const timestamp = now();
    const passwordHash = await hashPassword(password);
    this.database.db
      .prepare(
        'INSERT INTO users(uuid, login_id, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        user.uuid,
        user.id,
        user.name,
        passwordHash,
        user.role,
        timestamp,
        timestamp,
      );
    return user;
  }

  private issue(user: AuthUser) {
    const accessToken = jwt.sign(
      { sub: user.uuid, role: user.role },
      this.jwtSecret(),
      { expiresIn: '15m' },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.database.db
      .prepare(
        'INSERT INTO auth_sessions(id, user_uuid, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        user.uuid,
        hashToken(refreshToken),
        expiresAt,
        createdAt,
      );
    return {
      user,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900,
    };
  }

  private validatePassword(password: string) {
    const minimum = this.config.value.minPasswordLength;
    if (password.length < minimum)
      throw new ConflictException(
        `Password must contain at least ${minimum} characters`,
      );
  }

  private jwtSecret() {
    return this.config.value.jwtSecret;
  }

  private userByLogin(id: string) {
    return this.database.db
      .prepare('SELECT * FROM users WHERE login_id = ?')
      .get(id) as UserRow | undefined;
  }

  private publicUser(row: UserRow): AuthUser {
    return {
      uuid: row.uuid,
      id: row.login_id,
      name: row.name,
      role: row.role,
      managed: row.managed_by_env === 1,
    };
  }
}
