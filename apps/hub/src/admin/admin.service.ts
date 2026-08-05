import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import type { AuthUser, UserRole } from '../auth/auth.types';
import type {
  AdminGrant,
  AdminMaintainer,
  AdminPack,
  AdminRelease,
  AdminUser,
  PackVisibility,
} from '@nest/shared';
import {
  assertCanChangeRole,
  assertCanDeleteTarget,
  assertCanResetPassword,
  isAssignableRole,
} from '../auth/access-policy';
import { hashPassword } from '../auth/password';
import { HubRuntimeConfig } from '../hub.config';
import { PacksService } from '../packs/packs.service';
import { sortSemVerDesc } from '../packs/semver';

const now = () => new Date().toISOString();
export type PackPatch = {
  visibility?: PackVisibility;
  archived?: boolean;
};
type AdminUserView = AdminUser;
type PackRow = {
  id: string;
  name: string;
  description: string;
  visibility: 'public' | 'restricted';
  archived: number;
  created_at: string;
  updated_at: string;
};
type ReleaseRow = Omit<AdminRelease, 'yanked'> & { yanked: number };
type GrantRow = AdminGrant;
type MaintainerRow = AdminMaintainer & { pack_id: string };
type AdminPackView = AdminPack;

export function latestInstallableVersion(
  releases: Pick<AdminRelease, 'version' | 'yanked'>[],
): string | null {
  return (
    sortSemVerDesc(
      releases
        .filter((release) => !release.yanked)
        .map((release) => release.version),
    )[0] ?? null
  );
}

@Injectable()
export class AdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: HubRuntimeConfig,
    private readonly packsService: PacksService,
  ) {}

  async resyncRegistry(actor: AuthUser) {
    const result = await this.packsService.reconcileRegistry();
    this.audit.record(actor, 'registry.resync', 'registry', 'knowledge-packs', {
      packs_added: result.packs_added,
      packs_updated: result.packs_updated,
      packs_removed: result.packs_removed,
      releases_added: result.releases_added,
      releases_updated: result.releases_updated,
      releases_removed: result.releases_removed,
      issue_count: result.issues.length,
    });
    return result;
  }

  listUsers(): AdminUserView[] {
    const rows = this.database.db
      .prepare(
        `SELECT uuid, login_id AS id, name, role, managed_by_env, created_at, updated_at
      FROM users ORDER BY created_at DESC`,
      )
      .all() as Array<
      Omit<AdminUserView, 'managed'> & { managed_by_env: number }
    >;
    return rows.map(({ managed_by_env, ...user }) => ({
      ...user,
      managed: managed_by_env === 1,
    }));
  }

  updateUser(actor: AuthUser, uuid: string, role: UserRole): AdminUserView {
    if (!isAssignableRole(role)) throw new BadRequestException('Invalid role');
    const target = this.database.db
      .prepare('SELECT uuid, role, managed_by_env FROM users WHERE uuid = ?')
      .get(uuid) as
      { uuid: string; role: UserRole; managed_by_env: number } | undefined;
    if (!target) throw new NotFoundException('User not found');
    assertCanChangeRole(actor, {
      role: target.role,
      managed: target.managed_by_env === 1,
    });
    this.database.db
      .prepare('UPDATE users SET role = ?, updated_at = ? WHERE uuid = ?')
      .run(role, now(), uuid);
    this.audit.record(actor, 'user.role', 'user', uuid, { role });
    return this.listUsers().find((user) => user.uuid === uuid)!;
  }

  async removeUser(actor: AuthUser, uuid: string) {
    const target = this.database.db
      .prepare(
        'SELECT uuid, login_id AS id, name, role, managed_by_env FROM users WHERE uuid = ?',
      )
      .get(uuid) as
      | {
          uuid: string;
          id: string;
          name: string;
          role: UserRole;
          managed_by_env: number;
        }
      | undefined;
    if (!target) throw new NotFoundException('User not found');
    assertCanDeleteTarget(actor, {
      role: target.role,
      managed: target.managed_by_env === 1,
    });
    const staged = this.database.db
      .prepare(
        "SELECT staging_path FROM publish_requests WHERE submitter_uuid = ? AND status = 'pending'",
      )
      .all(uuid) as Array<{ staging_path: string }>;
    this.database.db.transaction(() => {
      this.database.db
        .prepare(
          "DELETE FROM publish_requests WHERE submitter_uuid = ? AND status = 'pending'",
        )
        .run(uuid);
      this.database.db.prepare('DELETE FROM users WHERE uuid = ?').run(uuid);
      this.audit.record(actor, 'user.delete', 'user', uuid, {
        id: target.id,
        name: target.name,
        role: target.role,
      });
    })();
    await Promise.all(
      staged.map(({ staging_path }) =>
        fs.unlink(staging_path).catch(() => undefined),
      ),
    );
    return { success: true };
  }

  async resetPassword(actor: AuthUser, uuid: string) {
    const defaultPassword = this.config.value.defaultResetPassword;
    if (!defaultPassword) {
      throw new BadRequestException(
        'DEFAULT_RESET_PASSWORD is not configured on the Hub',
      );
    }
    const target = this.database.db
      .prepare('SELECT uuid, role, managed_by_env FROM users WHERE uuid = ?')
      .get(uuid) as
      { uuid: string; role: UserRole; managed_by_env: number } | undefined;
    if (!target) throw new NotFoundException('User not found');
    assertCanResetPassword(actor, {
      role: target.role,
      managed: target.managed_by_env === 1,
    });
    const passwordHash = await hashPassword(defaultPassword);
    this.database.db.transaction(() => {
      this.database.db
        .prepare(
          'UPDATE users SET password_hash = ?, updated_at = ? WHERE uuid = ?',
        )
        .run(passwordHash, now(), uuid);
      this.database.db
        .prepare(
          'UPDATE auth_sessions SET revoked_at = ? WHERE user_uuid = ? AND revoked_at IS NULL',
        )
        .run(now(), uuid);
      this.audit.record(actor, 'user.password_reset', 'user', uuid, {});
    })();
    return { success: true };
  }

  listPacks(): AdminPackView[] {
    const packs = this.database.db
      .prepare(
        `SELECT id, name, description, visibility, archived, created_at, updated_at
      FROM packs ORDER BY id`,
      )
      .all() as PackRow[];
    const releases = this.database.db
      .prepare(
        `SELECT pack_id, version, yanked, checksum, published_at,
                patch_revision, patched_at
         FROM releases ORDER BY pack_id, published_at DESC`,
      )
      .all() as ReleaseRow[];
    const grants = this.database.db
      .prepare(
        `SELECT a.pack_id, u.uuid, u.login_id AS id, u.name FROM pack_access a JOIN users u ON u.uuid = a.user_uuid`,
      )
      .all() as GrantRow[];
    const maintainers = this.database.db
      .prepare(
        `SELECT m.pack_id, u.uuid, u.login_id AS id, u.name FROM pack_maintainers m JOIN users u ON u.uuid = m.user_uuid`,
      )
      .all() as MaintainerRow[];
    return packs.map((pack) => {
      const packReleases = releases
        .filter((r) => r.pack_id === pack.id)
        .map((r) => ({ ...r, yanked: r.yanked === 1 }));
      return {
        ...pack,
        archived: pack.archived === 1,
        latest_version: latestInstallableVersion(packReleases),
        releases: packReleases,
        grants: grants.filter((g) => g.pack_id === pack.id),
        maintainers: maintainers
          .filter((m) => m.pack_id === pack.id)
          .map(({ uuid, id, name }) => ({ uuid, id, name })),
      };
    });
  }

  updatePack(actor: AuthUser, id: string, patch: PackPatch): AdminPackView {
    const pack = this.database.db
      .prepare('SELECT * FROM packs WHERE id = ?')
      .get(id);
    if (!pack) throw new NotFoundException('Pack not found');
    if (
      patch.visibility != null &&
      !['public', 'restricted'].includes(patch.visibility)
    )
      throw new BadRequestException('Invalid visibility');
    this.database.db
      .prepare(
        `UPDATE packs SET
      visibility = COALESCE(?, visibility), archived = COALESCE(?, archived),
      updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.visibility ?? null,
        patch.archived === undefined ? null : Number(patch.archived),
        now(),
        id,
      );
    this.audit.record(actor, 'pack.update', 'pack', id, patch);
    return this.listPacks().find((item) => item.id === id)!;
  }

  async removePack(actor: AuthUser, id: string) {
    const pack = this.database.db
      .prepare('SELECT id, name, description FROM packs WHERE id = ?')
      .get(id) as { id: string; name: string; description: string } | undefined;
    if (!pack) throw new NotFoundException('Pack not found');
    const releaseCount = (
      this.database.db
        .prepare('SELECT COUNT(*) AS count FROM releases WHERE pack_id = ?')
        .get(id) as { count: number }
    ).count;
    const pending = this.database.db
      .prepare(
        "SELECT id, staging_path FROM publish_requests WHERE pack_id = ? AND status = 'pending'",
      )
      .all(id) as Array<{ id: string; staging_path: string }>;
    const registryRoot = this.config.value.registryPath;
    const projectPath = path.join(registryRoot, id);
    const temporaryPath = path.join(
      registryRoot,
      `.deleting-${id}-${randomUUID()}`,
    );
    const moved = await fs
      .rename(projectPath, temporaryPath)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    try {
      this.database.db.transaction(() => {
        this.database.db
          .prepare(
            `DELETE FROM messages WHERE publish_request_id IN
              (SELECT id FROM publish_requests WHERE pack_id = ? AND status = 'pending')`,
          )
          .run(id);
        this.database.db
          .prepare(
            "DELETE FROM publish_requests WHERE pack_id = ? AND status = 'pending'",
          )
          .run(id);
        this.database.db.prepare('DELETE FROM packs WHERE id = ?').run(id);
        this.audit.record(actor, 'pack.delete', 'pack', id, {
          name: pack.name,
          description: pack.description,
          releases: releaseCount,
        });
      })();
    } catch (error) {
      if (moved) await fs.rename(temporaryPath, projectPath);
      throw error;
    }
    await Promise.all([
      moved
        ? fs.rm(temporaryPath, { recursive: true, force: true })
        : Promise.resolve(),
      ...pending.map(({ staging_path }) =>
        fs.unlink(staging_path).catch(() => undefined),
      ),
    ]);
    return { success: true };
  }

  setGrant(
    actor: AuthUser,
    packId: string,
    userUuid: string,
    allowed: boolean,
  ) {
    if (
      !this.database.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(packId)
    )
      throw new NotFoundException('Pack not found');
    if (
      !this.database.db
        .prepare('SELECT 1 FROM users WHERE uuid = ?')
        .get(userUuid)
    )
      throw new NotFoundException('User not found');
    if (allowed)
      this.database.db
        .prepare(
          'INSERT OR IGNORE INTO pack_access(pack_id, user_uuid, created_at) VALUES (?, ?, ?)',
        )
        .run(packId, userUuid, now());
    else
      this.database.db
        .prepare('DELETE FROM pack_access WHERE pack_id = ? AND user_uuid = ?')
        .run(packId, userUuid);
    this.audit.record(
      actor,
      allowed ? 'pack.grant' : 'pack.revoke',
      'pack',
      packId,
      { user_uuid: userUuid },
    );
    return { success: true };
  }

  setMaintainer(
    actor: AuthUser,
    packId: string,
    userUuid: string,
    allowed: boolean,
  ) {
    if (
      !this.database.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(packId)
    )
      throw new NotFoundException('Pack not found');
    if (
      !this.database.db
        .prepare('SELECT 1 FROM users WHERE uuid = ?')
        .get(userUuid)
    )
      throw new NotFoundException('User not found');
    if (allowed)
      this.database.db
        .prepare(
          'INSERT OR IGNORE INTO pack_maintainers(pack_id, user_uuid, created_at) VALUES (?, ?, ?)',
        )
        .run(packId, userUuid, now());
    else
      this.database.db
        .prepare(
          'DELETE FROM pack_maintainers WHERE pack_id = ? AND user_uuid = ?',
        )
        .run(packId, userUuid);
    this.audit.record(
      actor,
      allowed ? 'pack.maintainer.add' : 'pack.maintainer.remove',
      'pack',
      packId,
      { user_uuid: userUuid },
    );
    return { success: true };
  }

  setYanked(actor: AuthUser, packId: string, version: string, yanked: boolean) {
    const result = this.database.db
      .prepare(
        'UPDATE releases SET yanked = ? WHERE pack_id = ? AND version = ?',
      )
      .run(Number(yanked), packId, version);
    if (!result.changes) throw new NotFoundException('Release not found');
    this.audit.record(
      actor,
      yanked ? 'release.yank' : 'release.restore',
      'release',
      `${packId}@${version}`,
    );
    return { success: true };
  }

  /**
   * Deletes one release. If it's the pack's only remaining version, this
   * deletes the whole pack instead (reusing removePack's cascade-safe
   * cleanup) — a knowledge pack with zero releases isn't a coherent state,
   * so the frontend must warn the user about that escalation up front.
   */
  async removeRelease(actor: AuthUser, packId: string, version: string) {
    const release = this.database.db
      .prepare('SELECT 1 FROM releases WHERE pack_id = ? AND version = ?')
      .get(packId, version);
    if (!release) throw new NotFoundException('Release not found');
    const releaseCount = (
      this.database.db
        .prepare('SELECT COUNT(*) AS count FROM releases WHERE pack_id = ?')
        .get(packId) as { count: number }
    ).count;
    if (releaseCount <= 1) {
      return this.removePack(actor, packId);
    }
    const registryRoot = this.config.value.registryPath;
    const versionPath = path.join(registryRoot, packId, version);
    const temporaryPath = path.join(
      registryRoot,
      `.deleting-${packId}-${version}-${randomUUID()}`,
    );
    const moved = await fs
      .rename(versionPath, temporaryPath)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    try {
      this.database.db
        .prepare('DELETE FROM releases WHERE pack_id = ? AND version = ?')
        .run(packId, version);
      this.audit.record(
        actor,
        'release.delete',
        'release',
        `${packId}@${version}`,
      );
    } catch (error) {
      if (moved) await fs.rename(temporaryPath, versionPath);
      throw error;
    }
    if (moved) await fs.rm(temporaryPath, { recursive: true, force: true });
    return { success: true };
  }
}
