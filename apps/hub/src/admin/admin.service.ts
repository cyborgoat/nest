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
  AdminPack,
  AdminRelease,
  AdminUser,
  PackVisibility,
} from '@nest/shared';
import {
  assertCanChangeRole,
  assertCanDeleteTarget,
  isAssignableRole,
} from '../auth/access-policy';
import { HubRuntimeConfig } from '../hub.config';

const now = () => new Date().toISOString();
export type PackPatch = {
  visibility?: PackVisibility;
  archived?: boolean;
  owner_id?: string | null;
};
type AdminUserView = AdminUser;
type PackRow = {
  id: string;
  name: string;
  description: string;
  owner_uuid: string | null;
  owner_id: string | null;
  visibility: 'public' | 'restricted';
  archived: number;
  created_at: string;
  updated_at: string;
};
type ReleaseRow = Omit<AdminRelease, 'yanked'> & { yanked: number };
type GrantRow = AdminGrant;
export type AdminPackView = AdminPack;

@Injectable()
export class AdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: HubRuntimeConfig,
  ) {}

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

  listPacks(): AdminPackView[] {
    const packs = this.database.db
      .prepare(
        `SELECT p.*, u.login_id AS owner_id FROM packs p
      LEFT JOIN users u ON u.uuid = p.owner_uuid ORDER BY p.id`,
      )
      .all() as PackRow[];
    const releases = this.database.db
      .prepare(
        'SELECT pack_id, version, yanked, checksum, published_at FROM releases ORDER BY pack_id, published_at DESC',
      )
      .all() as ReleaseRow[];
    const grants = this.database.db
      .prepare(
        `SELECT a.pack_id, u.uuid, u.login_id AS id, u.name FROM pack_access a JOIN users u ON u.uuid = a.user_uuid`,
      )
      .all() as GrantRow[];
    return packs.map((pack) => ({
      ...pack,
      archived: pack.archived === 1,
      releases: releases
        .filter((r) => r.pack_id === pack.id)
        .map((r) => ({ ...r, yanked: r.yanked === 1 })),
      grants: grants.filter((g) => g.pack_id === pack.id),
    }));
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
    let ownerUuid: string | null | undefined;
    if (patch.owner_id !== undefined) {
      if (patch.owner_id === null || patch.owner_id === '') ownerUuid = null;
      else {
        const owner = this.database.db
          .prepare('SELECT uuid FROM users WHERE login_id = ?')
          .get(patch.owner_id) as { uuid: string } | undefined;
        if (!owner)
          throw new BadRequestException('Owner account does not exist');
        ownerUuid = owner.uuid;
      }
    }
    this.database.db
      .prepare(
        `UPDATE packs SET
      visibility = COALESCE(?, visibility), archived = COALESCE(?, archived),
      owner_uuid = CASE WHEN ? = 1 THEN ? ELSE owner_uuid END, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.visibility ?? null,
        patch.archived === undefined ? null : Number(patch.archived),
        Number(ownerUuid !== undefined),
        ownerUuid ?? null,
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
}
