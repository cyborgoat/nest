import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { HubRuntimeConfig } from '../hub.config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private database!: Database.Database;

  constructor(private readonly config: HubRuntimeConfig) {}

  onModuleInit() {
    const file = this.config.value.databasePath;
    mkdirSync(path.dirname(file), { recursive: true });
    this.database = new Database(file);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.migrate();
    this.logger.log(`Database path: ${file}`);
  }

  get db(): Database.Database {
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
      CREATE TABLE IF NOT EXISTS releases (
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        checksum TEXT NOT NULL DEFAULT '',
        yanked INTEGER NOT NULL DEFAULT 0,
        submitted_by TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        approved_by TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        published_at TEXT NOT NULL,
        PRIMARY KEY(pack_id, version)
      );
      CREATE TABLE IF NOT EXISTS publish_requests (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        submitter_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        staging_path TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
        validation_json TEXT NOT NULL DEFAULT '{}',
        review_note TEXT,
        reviewer_uuid TEXT REFERENCES users(uuid) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pending_release_idx
        ON publish_requests(pack_id, version) WHERE status = 'pending';
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
  }
}
