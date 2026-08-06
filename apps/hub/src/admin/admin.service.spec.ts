import type { AdminRelease } from '@nest/shared';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../database/audit.service';
import { DatabaseService } from '../database/database.service';
import type { HubRuntimeConfig } from '../hub.config';
import type { PacksService } from '../packs/packs.service';
import { AdminService, latestInstallableVersion } from './admin.service';

function release(version: string, yanked = false): AdminRelease {
  return {
    pack_id: 'example',
    version,
    yanked,
    checksum: 'checksum',
    published_at: '2026-01-01T00:00:00.000Z',
    patch_revision: 0,
    patched_at: null,
  };
}

describe('latestInstallableVersion', () => {
  it('returns the highest non-yanked semantic version', () => {
    expect(
      latestInstallableVersion([
        release('1.9.0'),
        release('10.0.0', true),
        release('2.0.0'),
      ]),
    ).toBe('2.0.0');
  });

  it('returns null when every release is yanked', () => {
    expect(
      latestInstallableVersion([
        release('1.0.0', true),
        release('2.0.0', true),
      ]),
    ).toBeNull();
  });
});

describe('AdminService pack attribution', () => {
  let directory: string;
  let database: DatabaseService;
  let service: AdminService;
  let config: HubRuntimeConfig;

  const actor: AuthUser = {
    uuid: 'admin-uuid',
    id: 'admin',
    name: 'Administrator',
    role: 'admin',
    managed: false,
  };

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nest-admin-author-'));
    config = {
      value: {
        databasePath: path.join(directory, 'hub.sqlite3'),
        registryPath: path.join(directory, 'registry'),
      },
    } as HubRuntimeConfig;
    database = new DatabaseService(config);
    database.onModuleInit();
    service = new AdminService(
      database,
      new AuditService(database),
      config,
      {} as PacksService,
    );
    const timestamp = '2026-08-06T00:00:00.000Z';
    const insertUser = database.db.prepare(
      `INSERT INTO users(uuid, login_id, name, password_hash, role, managed_by_env, created_at, updated_at)
       VALUES (?, ?, ?, 'hash', ?, 0, ?, ?)`,
    );
    insertUser.run(
      actor.uuid,
      actor.id,
      actor.name,
      actor.role,
      timestamp,
      timestamp,
    );
    insertUser.run(
      'author-uuid',
      'first-author',
      'First Author',
      'user',
      timestamp,
      timestamp,
    );
    insertUser.run(
      'next-author-uuid',
      'next-author',
      'Next Author',
      'user',
      timestamp,
      timestamp,
    );
    database.db
      .prepare(
        `INSERT INTO packs(id, name, description, owner_uuid, visibility, archived, created_at, updated_at)
         VALUES ('guide', 'Guide', '', 'author-uuid', 'public', 0, ?, ?)`,
      )
      .run(timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO pack_maintainers(pack_id, user_uuid, created_at)
         VALUES ('guide', 'author-uuid', ?)`,
      )
      .run(timestamp);
  });

  afterEach(async () => {
    database.onModuleDestroy();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the credited author separately from maintainers and lets an admin change it', () => {
    expect(service.listPacks()[0]).toMatchObject({
      author: {
        uuid: 'author-uuid',
        id: 'first-author',
        name: 'First Author',
      },
      maintainers: [
        {
          uuid: 'author-uuid',
          id: 'first-author',
          name: 'First Author',
        },
      ],
    });

    const updated = service.updatePack(actor, 'guide', {
      author_uuid: 'next-author-uuid',
    });
    expect(updated.author).toMatchObject({
      uuid: 'next-author-uuid',
      id: 'next-author',
      name: 'Next Author',
    });
    expect(updated.maintainers).toHaveLength(1);

    expect(
      service.updatePack(actor, 'guide', { author_uuid: null }).author,
    ).toBeNull();
  });
});
