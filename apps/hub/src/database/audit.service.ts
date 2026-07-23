import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { DatabaseService } from './database.service';

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  record(
    actor: AuthUser,
    action: string,
    target_type: string,
    target_id: string,
    details: object = {},
  ): void {
    this.database.db
      .prepare(
        'INSERT INTO audit_log(id, actor_uuid, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        actor.uuid,
        action,
        target_type,
        target_id,
        JSON.stringify(details),
        new Date().toISOString(),
      );
  }
}
