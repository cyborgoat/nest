import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import type { HubMessage, MessageKind, MessagePage } from './messages.types';

type Cursor = { created_at: string; id: string };

@Injectable()
export class MessagesService {
  constructor(private readonly database: DatabaseService) {}

  create(input: {
    userUuid: string;
    kind: MessageKind;
    title: string;
    body: string;
    packId?: string;
    publishRequestId?: string;
    eventKey: string;
    createdAt?: string;
  }) {
    this.database.db
      .prepare(
        `INSERT OR IGNORE INTO messages
          (id, user_uuid, kind, title, body, pack_id, publish_request_id, event_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.userUuid,
        input.kind,
        input.title,
        input.body,
        input.packId ?? null,
        input.publishRequestId ?? null,
        input.eventKey,
        input.createdAt ?? new Date().toISOString(),
      );
  }

  list(
    user: AuthUser,
    filter = 'all',
    requestedLimit = 30,
    encodedCursor?: string,
  ): MessagePage {
    if (filter !== 'all' && filter !== 'unread')
      throw new BadRequestException('filter must be all or unread');
    const limit = Math.min(Math.max(requestedLimit || 30, 1), 100);
    const cursor = encodedCursor ? this.decodeCursor(encodedCursor) : null;
    const conditions = ['user_uuid = ?'];
    const params: unknown[] = [user.uuid];
    if (filter === 'unread') conditions.push('read_at IS NULL');
    if (cursor) {
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }
    const rows = this.database.db
      .prepare(
        `SELECT id, kind, title, body, pack_id, publish_request_id, read_at, created_at
         FROM messages WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as HubMessage[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next_cursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ created_at: last.created_at, id: last.id }),
            ).toString('base64url')
          : null,
    };
  }

  unreadCount(user: AuthUser) {
    const row = this.database.db
      .prepare(
        'SELECT COUNT(*) AS count FROM messages WHERE user_uuid = ? AND read_at IS NULL',
      )
      .get(user.uuid) as { count: number };
    return { count: row.count };
  }

  markRead(user: AuthUser, id: string) {
    this.requireOwned(user, id);
    this.database.db
      .prepare(
        'UPDATE messages SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_uuid = ?',
      )
      .run(new Date().toISOString(), id, user.uuid);
    return { ok: true };
  }

  markAllRead(user: AuthUser) {
    const result = this.database.db
      .prepare(
        'UPDATE messages SET read_at = ? WHERE user_uuid = ? AND read_at IS NULL',
      )
      .run(new Date().toISOString(), user.uuid);
    return { updated: result.changes };
  }

  remove(user: AuthUser, id: string) {
    this.requireOwned(user, id);
    this.database.db
      .prepare('DELETE FROM messages WHERE id = ? AND user_uuid = ?')
      .run(id, user.uuid);
    return { ok: true };
  }

  removeRead(user: AuthUser) {
    const result = this.database.db
      .prepare(
        'DELETE FROM messages WHERE user_uuid = ? AND read_at IS NOT NULL',
      )
      .run(user.uuid);
    return { deleted: result.changes };
  }

  private requireOwned(user: AuthUser, id: string) {
    const found = this.database.db
      .prepare('SELECT 1 FROM messages WHERE id = ? AND user_uuid = ?')
      .get(id, user.uuid);
    if (!found) throw new NotFoundException('Message not found');
  }

  private decodeCursor(value: string): Cursor {
    try {
      const cursor = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<Cursor>;
      if (!cursor.created_at || !cursor.id) throw new Error('invalid');
      return { created_at: cursor.created_at, id: cursor.id };
    } catch {
      throw new BadRequestException('Invalid message cursor');
    }
  }
}
