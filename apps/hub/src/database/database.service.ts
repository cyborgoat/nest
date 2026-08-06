import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { mkdirSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import { HubRuntimeConfig } from '../hub.config';

class HubDatabase extends DatabaseSync {
  transaction<Arguments extends unknown[], Result>(
    callback: (...args: Arguments) => Result,
  ): (...args: Arguments) => Result {
    return (...args) => {
      this.exec('BEGIN IMMEDIATE');
      try {
        const result = callback(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.exec('ROLLBACK');
        } catch {
          // Preserve the original transaction error if rollback also fails.
        }
        throw error;
      }
    };
  }
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private database!: HubDatabase;

  constructor(private readonly config: HubRuntimeConfig) {}

  onModuleInit() {
    const file = this.config.value.databasePath;
    mkdirSync(path.dirname(file), { recursive: true });
    this.database = new HubDatabase(file);
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.logger.log(`Database path: ${file}`);
  }

  get db(): HubDatabase {
    return this.database;
  }

  onModuleDestroy() {
    this.database?.close();
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uuid TEXT PRIMARY KEY,
        login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'admin', 'superuser')) DEFAULT 'user',
        managed_by_env INTEGER NOT NULL CHECK(managed_by_env IN (0, 1)) DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_managed_superuser_idx
        ON users(managed_by_env) WHERE managed_by_env = 1;
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('public', 'restricted')) DEFAULT 'public',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pack_access (
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(pack_id, user_uuid)
      );
      CREATE TABLE IF NOT EXISTS pack_maintainers (
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(pack_id, user_uuid)
      );
      CREATE TABLE IF NOT EXISTS releases (
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        checksum TEXT NOT NULL DEFAULT '',
        yanked INTEGER NOT NULL DEFAULT 0,
        submitted_by TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        approved_by TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        published_at TEXT NOT NULL,
        patch_revision INTEGER NOT NULL DEFAULT 0,
        patched_at TEXT,
        PRIMARY KEY(pack_id, version)
      );
      CREATE TABLE IF NOT EXISTS publish_requests (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        commit_message TEXT NOT NULL DEFAULT '',
        submitter_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        staging_path TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
        validation_json TEXT NOT NULL DEFAULT '{}',
        review_note TEXT,
        reviewer_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        submitter_id_snapshot TEXT,
        submitter_name_snapshot TEXT,
        reviewer_id_snapshot TEXT,
        reviewer_name_snapshot TEXT,
        base_version TEXT,
        review_artifact_path TEXT,
        request_type TEXT NOT NULL DEFAULT 'release'
          CHECK(request_type IN ('release', 'live_patch')),
        patch_revision INTEGER,
        base_patch_revision INTEGER,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pending_release_idx
        ON publish_requests(pack_id, version) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS publish_requests_pack_status_idx
        ON publish_requests(pack_id, status);
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_uuid TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('publish_submitted', 'publish_approved', 'publish_rejected')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        pack_id TEXT,
        publish_request_id TEXT REFERENCES publish_requests(id) ON DELETE SET NULL,
        event_key TEXT NOT NULL UNIQUE,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_user_created_idx
        ON messages(user_uuid, created_at DESC);
      CREATE INDEX IF NOT EXISTS messages_user_unread_idx
        ON messages(user_uuid, read_at) WHERE read_at IS NULL;
    `);
    // The credited author starts as a maintainer. Backfill older databases
    // where owner_uuid existed before the separate maintainer list.
    this.database.exec(`
      INSERT OR IGNORE INTO pack_maintainers(pack_id, user_uuid, created_at)
      SELECT id, owner_uuid, created_at FROM packs WHERE owner_uuid IS NOT NULL;
    `);
    this.ensurePublishRequestHistoryColumns();
    this.ensureLivePatchColumns();
  }

  private ensurePublishRequestHistoryColumns() {
    const columns = new Set(
      (
        this.database.prepare('PRAGMA table_info(publish_requests)').all() as {
          name: string;
        }[]
      ).map((column) => column.name),
    );
    const additions = [
      ['submitter_id_snapshot', 'TEXT'],
      ['submitter_name_snapshot', 'TEXT'],
      ['reviewer_id_snapshot', 'TEXT'],
      ['reviewer_name_snapshot', 'TEXT'],
      ['base_version', 'TEXT'],
      ['review_artifact_path', 'TEXT'],
    ] as const;
    for (const [name, type] of additions) {
      if (!columns.has(name)) {
        this.database.exec(
          `ALTER TABLE publish_requests ADD COLUMN ${name} ${type}`,
        );
      }
    }
    this.database.exec(`
      UPDATE publish_requests
      SET submitter_id_snapshot = COALESCE(
            submitter_id_snapshot,
            (SELECT login_id FROM users WHERE uuid = submitter_uuid)
          ),
          submitter_name_snapshot = COALESCE(
            submitter_name_snapshot,
            (SELECT name FROM users WHERE uuid = submitter_uuid)
          )
      WHERE submitter_id_snapshot IS NULL OR submitter_name_snapshot IS NULL;

      UPDATE publish_requests
      SET reviewer_id_snapshot = COALESCE(
            reviewer_id_snapshot,
            (SELECT login_id FROM users WHERE uuid = reviewer_uuid)
          ),
          reviewer_name_snapshot = COALESCE(
            reviewer_name_snapshot,
            (SELECT name FROM users WHERE uuid = reviewer_uuid)
          )
      WHERE reviewer_uuid IS NOT NULL
        AND (reviewer_id_snapshot IS NULL OR reviewer_name_snapshot IS NULL);
    `);
  }

  private ensureLivePatchColumns() {
    const addMissing = (
      table: 'releases' | 'publish_requests',
      additions: readonly (readonly [string, string])[],
    ) => {
      const columns = new Set(
        (
          this.database.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
          }[]
        ).map((column) => column.name),
      );
      for (const [name, type] of additions) {
        if (!columns.has(name)) {
          this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
        }
      }
    };
    addMissing('releases', [
      ['patch_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['patched_at', 'TEXT'],
    ]);
    addMissing('publish_requests', [
      ['commit_message', "TEXT NOT NULL DEFAULT ''"],
      ['request_type', "TEXT NOT NULL DEFAULT 'release'"],
      ['patch_revision', 'INTEGER'],
      ['base_patch_revision', 'INTEGER'],
    ]);
  }
}
