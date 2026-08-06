import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, promises as fs } from 'fs';
import * as path from 'path';
import { isRegistryAdmin } from '../auth/access-policy';
import type { AuthUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import { HubRuntimeConfig } from '../hub.config';
import { MessagesService } from '../messages/messages.service';
import { isValidPackId, slugifyPackId } from '../packs/pack-id';
import { isValidSemVer } from '../packs/semver';
import type {
  AdminPublishReviewDetail,
  AdminPublishHistoryPage,
  AdminPublishRequest,
  KnowledgePackMeta,
  LocalPackInspection,
  PendingPublishRequest,
  PublishReviewFileDetail,
  PublishRequestType,
  PublishRequestStatus,
} from '@nest/shared';
import { PublishReviewService } from './publish-review.service';

const now = () => new Date().toISOString();

type ValidatedPack = {
  id: string;
  name: string;
  description: string;
  version: string;
  files: string[];
};
export type UploadedPackFile = {
  buffer: Buffer;
  originalname?: string;
  size?: number;
};
type PublishRequestRow = {
  id: string;
  pack_id: string;
  version: string;
  name: string;
  description: string;
  commit_message: string;
  submitter_uuid: string | null;
  staging_path: string;
  checksum: string;
  status: PublishRequestStatus;
  validation_json: string;
  review_note: string | null;
  reviewer_uuid: string | null;
  submitter_id_snapshot: string | null;
  submitter_name_snapshot: string | null;
  reviewer_id_snapshot: string | null;
  reviewer_name_snapshot: string | null;
  base_version: string | null;
  review_artifact_path: string | null;
  request_type: PublishRequestType;
  patch_revision: number | null;
  base_patch_revision: number | null;
  created_at: string;
  reviewed_at: string | null;
};
type PublishRequestView = Omit<
  PublishRequestRow,
  | 'staging_path'
  | 'submitter_uuid'
  | 'submitter_id_snapshot'
  | 'submitter_name_snapshot'
  | 'reviewer_id_snapshot'
  | 'reviewer_name_snapshot'
  | 'base_version'
  | 'review_artifact_path'
>;
type PendingRequestView = PendingPublishRequest;

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: HubRuntimeConfig,
    private readonly messages: MessagesService,
    private readonly audit_log: AuditService,
    private readonly publishReview: PublishReviewService,
  ) {}

  private normalizeCommitMessage(value?: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if ([...normalized].length > 500) {
      throw new BadRequestException(
        'Publish commit message must be 500 characters or fewer',
      );
    }
    return normalized;
  }

  submitRelease(
    user: AuthUser,
    file: UploadedPackFile,
    metadata?: KnowledgePackMeta,
    commitMessage?: string,
  ): Promise<PublishRequestView> {
    return this.submitWithDiagnostics(user, file, {
      requestType: 'release',
      metadata,
      commitMessage: this.normalizeCommitMessage(commitMessage),
    });
  }

  submitLivePatch(
    user: AuthUser,
    file: UploadedPackFile,
    packId: string,
    targetVersion: string,
    commitMessage?: string,
  ): Promise<PublishRequestView> {
    return this.submitWithDiagnostics(user, file, {
      requestType: 'live_patch',
      packId,
      targetVersion,
      commitMessage: this.normalizeCommitMessage(commitMessage),
    });
  }

  private async submitWithDiagnostics(
    user: AuthUser,
    file: UploadedPackFile,
    operation:
      | {
          requestType: 'release';
          metadata?: KnowledgePackMeta;
          commitMessage: string;
        }
      | {
          requestType: 'live_patch';
          packId: string;
          targetVersion: string;
          commitMessage: string;
        },
  ): Promise<PublishRequestView> {
    try {
      return await this.submit(user, file, operation);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'publish_submission_rejected',
          request_type: operation.requestType,
          pack_id:
            operation.requestType === 'live_patch'
              ? operation.packId
              : undefined,
          version:
            operation.requestType === 'live_patch'
              ? operation.targetVersion
              : undefined,
          submitter_id: user.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  private async submit(
    user: AuthUser,
    file: UploadedPackFile,
    operation:
      | {
          requestType: 'release';
          metadata?: KnowledgePackMeta;
          commitMessage: string;
        }
      | {
          requestType: 'live_patch';
          packId: string;
          targetVersion: string;
          commitMessage: string;
        },
  ): Promise<PublishRequestView> {
    this.assertUploadable(file);
    const { pack, buffer } = this.validateZip(
      file.buffer,
      operation.requestType === 'release' ? operation.metadata : undefined,
    );
    const requestType = operation.requestType;
    const commitMessage = operation.commitMessage;
    if (
      requestType === 'live_patch' &&
      (operation.packId !== pack.id || operation.targetVersion !== pack.version)
    )
      throw new BadRequestException(
        'Live patch route must match the ZIP pack id and version',
      );
    const db = this.database.db;
    const existing = db
      .prepare('SELECT 1 FROM packs WHERE id = ?')
      .get(pack.id);
    if (existing && !isRegistryAdmin(user)) {
      const isMaintainer = db
        .prepare(
          'SELECT 1 FROM pack_maintainers WHERE pack_id = ? AND user_uuid = ?',
        )
        .get(pack.id, user.uuid);
      if (!isMaintainer) {
        throw new ForbiddenException(
          'Only a pack maintainer may submit a new version',
        );
      }
    }
    // Pack-wide lock: no new submission for this pack — at any version, from
    // anyone, admins included — while an earlier one is still unresolved.
    const pending = db
      .prepare(
        "SELECT id, version FROM publish_requests WHERE pack_id = ? AND status = 'pending' LIMIT 1",
      )
      .get(pack.id) as { id: string; version: string } | undefined;
    if (pending) {
      throw new ConflictException(
        `${pack.id} already has a pending publish request for version ${pending.version} — wait for it to be approved or rejected before submitting again`,
      );
    }
    const existingRelease = db
      .prepare(
        `SELECT r.patch_revision, r.yanked
         FROM releases r
         WHERE r.pack_id = ? AND r.version = ?`,
      )
      .get(pack.id, pack.version) as
      | {
          patch_revision: number;
          yanked: number;
        }
      | undefined;
    if (requestType === 'release' && existingRelease) {
      throw new ConflictException(
        `Pack release already exists: ${pack.id}@${pack.version}`,
      );
    }
    if (requestType === 'live_patch') {
      if (!existingRelease)
        throw new NotFoundException(
          `Pack release not found: ${pack.id}@${pack.version}`,
        );
      if (existingRelease.yanked)
        throw new ConflictException('Yanked releases cannot be live patched');
      const targetManifest = await this.readReleaseManifest(
        pack.id,
        pack.version,
      );
      if (
        pack.name !== targetManifest.name ||
        pack.description !== targetManifest.description
      )
        throw new BadRequestException(
          'Live patches cannot change pack name, description, id, path, or version',
        );
    }
    const stagingRoot = this.config.value.stagingPath;
    mkdirSync(stagingRoot, { recursive: true });
    const requestId = randomUUID();
    const stagingPath = path.join(stagingRoot, `${requestId}.zip`);
    await fs.writeFile(stagingPath, buffer);
    let reviewArtifact: Awaited<ReturnType<PublishReviewService['build']>>;
    try {
      reviewArtifact = await this.publishReview.build(
        requestId,
        pack.id,
        buffer,
        requestType === 'live_patch' ? pack.version : undefined,
      );
      if (
        reviewArtifact.baseVersion !== null &&
        reviewArtifact.meaningfulChangedFiles === 0
      ) {
        await fs.rm(reviewArtifact.artifactPath, {
          recursive: true,
          force: true,
        });
        throw new BadRequestException(
          'The pack has no changes from its current published version',
        );
      }
    } catch (error) {
      await fs.unlink(stagingPath).catch(() => undefined);
      throw error;
    }
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const timestamp = now();
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO publish_requests(
            id, pack_id, version, name, description, commit_message, submitter_uuid,
            submitter_id_snapshot, submitter_name_snapshot, staging_path,
            checksum, status, validation_json, base_version,
            review_artifact_path, request_type, patch_revision,
            base_patch_revision, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          requestId,
          pack.id,
          pack.version,
          pack.name,
          pack.description,
          commitMessage,
          user.uuid,
          user.id,
          user.name,
          stagingPath,
          checksum,
          JSON.stringify({ files: pack.files }),
          reviewArtifact.baseVersion,
          reviewArtifact.artifactPath,
          requestType,
          requestType === 'live_patch'
            ? (existingRelease?.patch_revision ?? 0) + 1
            : null,
          requestType === 'live_patch'
            ? (existingRelease?.patch_revision ?? 0)
            : null,
          timestamp,
        );
        this.messages.create({
          userUuid: user.uuid,
          kind: 'publish_submitted',
          title:
            requestType === 'live_patch'
              ? 'Live patch submitted'
              : 'Publish request submitted',
          body:
            requestType === 'live_patch'
              ? `${pack.name} ${pack.version} · Patch ${(existingRelease?.patch_revision ?? 0) + 1} is waiting for review.`
              : `${pack.name} ${pack.version} is waiting for review.`,
          packId: pack.id,
          publishRequestId: requestId,
          eventKey: `publish:${requestId}:submitted`,
          createdAt: timestamp,
        });
      })();
    } catch (error) {
      await Promise.all([
        fs.unlink(stagingPath).catch(() => undefined),
        fs
          .rm(reviewArtifact.artifactPath, { recursive: true, force: true })
          .catch(() => undefined),
      ]);
      throw error;
    }
    this.logger.log(
      JSON.stringify({
        event: 'publish_submission_accepted',
        request_id: requestId,
        request_type: requestType,
        pack_id: pack.id,
        version: pack.version,
        patch_revision:
          requestType === 'live_patch'
            ? (existingRelease?.patch_revision ?? 0) + 1
            : null,
        submitter_id: user.id,
      }),
    );
    return this.getRequest(requestId, user);
  }

  listMine(user: AuthUser): PublishRequestView[] {
    return this.database.db
      .prepare(
        `SELECT id, pack_id, version, name, description, commit_message, status, request_type,
                patch_revision, base_patch_revision, review_note, created_at, reviewed_at
      FROM publish_requests WHERE submitter_uuid = ? ORDER BY created_at DESC`,
      )
      .all(user.uuid) as PublishRequestView[];
  }

  listPending(): PendingRequestView[] {
    return this.database.db
      .prepare(
        `SELECT r.id, r.pack_id, r.version, r.name, r.description, r.commit_message, r.status,
      r.request_type, r.patch_revision, r.base_patch_revision, r.checksum,
      r.validation_json, r.created_at, u.login_id AS submitter_id, u.name AS submitter_name
      FROM publish_requests r JOIN users u ON u.uuid = r.submitter_uuid
      WHERE r.status = 'pending' ORDER BY r.created_at`,
      )
      .all() as PendingRequestView[];
  }

  listHistory(
    status = 'all',
    requestedLimit = 50,
    encodedCursor?: string,
  ): AdminPublishHistoryPage {
    if (!['all', 'approved', 'rejected'].includes(status))
      throw new BadRequestException(
        'status must be all, approved, or rejected',
      );
    const normalizedLimit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : 50;
    const limit = Math.min(normalizedLimit, 100);
    const cursor = encodedCursor
      ? this.decodeHistoryCursor(encodedCursor)
      : null;
    const conditions = ["r.status IN ('approved', 'rejected')"];
    const params: (string | number)[] = [];
    if (status !== 'all') {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (cursor) {
      conditions.push(
        '(r.reviewed_at < ? OR (r.reviewed_at = ? AND r.id < ?))',
      );
      params.push(cursor.reviewed_at, cursor.reviewed_at, cursor.id);
    }
    const rows = this.database.db
      .prepare(
        `SELECT
          r.id, r.pack_id, r.version, r.name, r.description, r.commit_message, r.status,
          r.request_type, r.patch_revision, r.base_patch_revision,
          r.checksum, r.validation_json, r.review_note, r.created_at,
          r.reviewed_at,
          COALESCE(r.submitter_id_snapshot, submitter.login_id) AS submitter_id,
          COALESCE(r.submitter_name_snapshot, submitter.name) AS submitter_name,
          COALESCE(r.reviewer_id_snapshot, reviewer.login_id) AS reviewer_id,
          COALESCE(r.reviewer_name_snapshot, reviewer.name) AS reviewer_name
        FROM publish_requests r
        LEFT JOIN users submitter ON submitter.uuid = r.submitter_uuid
        LEFT JOIN users reviewer ON reviewer.uuid = r.reviewer_uuid
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.reviewed_at DESC, r.id DESC
        LIMIT ?`,
      )
      .all(...params, limit + 1) as AdminPublishRequest[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next_cursor:
        hasMore && last?.reviewed_at
          ? Buffer.from(
              JSON.stringify({ reviewed_at: last.reviewed_at, id: last.id }),
            ).toString('base64url')
          : null,
    };
  }

  async approve(
    requestId: string,
    reviewer: AuthUser,
    note?: string,
  ): Promise<PublishRequestView> {
    const request = this.requestRow(requestId);
    if (request.status !== 'pending')
      throw new ConflictException('Request has already been reviewed');
    const zipBytes = await fs.readFile(request.staging_path);
    const { pack: validated } = this.validateZip(zipBytes);
    const root = this.config.value.registryPath;
    const projectDir = path.join(root, validated.id);
    const destination = path.join(projectDir, validated.version);
    const isLivePatch = request.request_type === 'live_patch';
    const currentRelease = this.database.db
      .prepare(
        'SELECT patch_revision, yanked FROM releases WHERE pack_id = ? AND version = ?',
      )
      .get(validated.id, validated.version) as
      { patch_revision: number; yanked: number } | undefined;
    if (isLivePatch) {
      if (!currentRelease)
        throw new ConflictException('Target release no longer exists');
      if (currentRelease.yanked)
        throw new ConflictException('Yanked releases cannot be live patched');
      if (currentRelease.patch_revision !== request.base_patch_revision)
        throw new ConflictException(
          'The release changed after this live patch was submitted',
        );
    } else if (
      currentRelease ||
      (await fs
        .stat(destination)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new ConflictException('Release directory already exists');
    }
    const extractRoot = path.join(
      path.dirname(request.staging_path),
      `${request.id}-extract`,
    );
    await fs.rm(extractRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });
    new AdmZip(zipBytes).extractAllTo(extractRoot, true);
    mkdirSync(projectDir, { recursive: true });
    const candidate = path.join(extractRoot, validated.id);
    const backup = path.join(
      path.dirname(request.staging_path),
      `${request.id}-backup`,
    );
    if (isLivePatch) {
      await fs.rm(backup, { recursive: true, force: true });
      await fs.rename(destination, backup);
      try {
        await fs.rename(candidate, destination);
      } catch (error) {
        await fs.rename(backup, destination);
        throw error;
      }
    } else {
      await fs.rename(candidate, destination);
    }
    await fs.rm(extractRoot, { recursive: true, force: true });
    const timestamp = now();
    try {
      this.database.db.transaction(() => {
        const resolved = this.database.db
          .prepare(
            `UPDATE publish_requests
             SET status = 'approved', review_note = ?, reviewer_uuid = ?,
                 reviewer_id_snapshot = ?, reviewer_name_snapshot = ?,
                 reviewed_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(
            note?.trim() || null,
            reviewer.uuid,
            reviewer.id,
            reviewer.name,
            timestamp,
            requestId,
          );
        if (resolved.changes !== 1)
          throw new ConflictException('Request has already been resolved');
        const packInsert = this.database.db
          .prepare(
            `INSERT OR IGNORE INTO packs(id, name, description, owner_uuid, visibility, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'public', 0, ?, ?)`,
          )
          .run(
            validated.id,
            validated.name,
            validated.description,
            request.submitter_uuid,
            timestamp,
            timestamp,
          );
        // Only the pack's very first approval seeds the maintainer list —
        // an admin approving a later version bump on someone else's pack
        // shouldn't silently make themselves a co-maintainer.
        if (packInsert.changes > 0 && request.submitter_uuid) {
          this.database.db
            .prepare(
              'INSERT OR IGNORE INTO pack_maintainers(pack_id, user_uuid, created_at) VALUES (?, ?, ?)',
            )
            .run(validated.id, request.submitter_uuid, timestamp);
        }
        if (isLivePatch) {
          const updated = this.database.db
            .prepare(
              `UPDATE releases
               SET checksum = ?, patch_revision = ?, patched_at = ?
               WHERE pack_id = ? AND version = ? AND patch_revision = ?`,
            )
            .run(
              request.checksum,
              request.patch_revision,
              timestamp,
              validated.id,
              validated.version,
              request.base_patch_revision,
            );
          if (updated.changes !== 1)
            throw new ConflictException(
              'The release changed while approving this live patch',
            );
        } else {
          this.database.db
            .prepare(
              `INSERT INTO releases(pack_id, version, storage_path, checksum, submitted_by, approved_by, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              validated.id,
              validated.version,
              path.join(validated.id, validated.version),
              request.checksum,
              request.submitter_uuid,
              reviewer.uuid,
              timestamp,
            );
        }
        this.audit_log.record(
          reviewer,
          isLivePatch ? 'publish.live_patch.approve' : 'publish.approve',
          'publish_request',
          requestId,
          {
            pack_id: validated.id,
            version: validated.version,
            patch_revision: request.patch_revision,
            note: note?.trim() || null,
          },
        );
        if (request.submitter_uuid) {
          // Always log a receipt, even when the reviewer is the submitter
          // (e.g. an admin approving their own upload) — it's a confirmation
          // of what happened, not just a notification to someone else.
          this.messages.create({
            userUuid: request.submitter_uuid,
            kind: 'publish_approved',
            title: isLivePatch
              ? 'Live patch approved'
              : 'Knowledge pack published',
            body: `${
              isLivePatch
                ? `${validated.name} ${validated.version} · Patch ${request.patch_revision} was approved and is available on the Hub.`
                : `${validated.name} ${validated.version} was approved and released to the Hub.`
            }${note?.trim() ? ` Reviewer comment: ${note.trim()}` : ''}`,
            packId: validated.id,
            publishRequestId: requestId,
            eventKey: `publish:${requestId}:approved`,
            createdAt: timestamp,
          });
        }
      })();
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      if (isLivePatch) {
        await fs.rename(backup, destination).catch(() => undefined);
      }
      throw error;
    }
    if (isLivePatch) {
      await fs.rm(backup, { recursive: true, force: true });
    }
    await fs.unlink(request.staging_path).catch(() => undefined);
    return this.getRequest(requestId, reviewer);
  }

  async reject(
    requestId: string,
    reviewer: AuthUser,
    note: string,
  ): Promise<PublishRequestView> {
    if (!note.trim())
      throw new BadRequestException('A rejection note is required');
    const request = this.requestRow(requestId);
    if (request.status !== 'pending')
      throw new ConflictException('Request has already been reviewed');
    const timestamp = now();
    this.database.db.transaction(() => {
      const resolved = this.database.db
        .prepare(
          `UPDATE publish_requests
           SET status = 'rejected', review_note = ?, reviewer_uuid = ?,
               reviewer_id_snapshot = ?, reviewer_name_snapshot = ?,
               reviewed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          note.trim(),
          reviewer.uuid,
          reviewer.id,
          reviewer.name,
          timestamp,
          requestId,
        );
      if (resolved.changes !== 1)
        throw new ConflictException('Request has already been resolved');
      this.audit_log.record(
        reviewer,
        request.request_type === 'live_patch'
          ? 'publish.live_patch.reject'
          : 'publish.reject',
        'publish_request',
        requestId,
        {
          note: note.trim(),
        },
      );
      if (request.submitter_uuid) {
        // Always log a receipt, even when the reviewer is the submitter.
        this.messages.create({
          userUuid: request.submitter_uuid,
          kind: 'publish_rejected',
          title:
            request.request_type === 'live_patch'
              ? 'Live patch needs changes'
              : 'Publish request needs changes',
          body: `${request.name} ${request.version}${
            request.request_type === 'live_patch'
              ? ` · Patch ${request.patch_revision}`
              : ''
          } was not approved: ${note.trim()}`,
          packId: request.pack_id,
          publishRequestId: requestId,
          eventKey: `publish:${requestId}:rejected`,
          createdAt: timestamp,
        });
      }
    })();
    await fs.unlink(request.staging_path).catch(() => undefined);
    return this.getRequest(requestId, reviewer);
  }

  async cancel(
    requestId: string,
    user: AuthUser,
  ): Promise<{ success: true; request_id: string; pack_id: string }> {
    const request = this.requestRow(requestId);
    if (request.submitter_uuid !== user.uuid)
      throw new ForbiddenException(
        'Only the original submitter can cancel this publish request',
      );
    if (request.status !== 'pending')
      throw new ConflictException(
        'Only pending publish requests can be cancelled',
      );

    this.database.db.transaction(() => {
      const deleted = this.database.db
        .prepare(
          "DELETE FROM publish_requests WHERE id = ? AND submitter_uuid = ? AND status = 'pending'",
        )
        .run(requestId, user.uuid);
      if (deleted.changes !== 1)
        throw new ConflictException(
          'Publish request has already been resolved',
        );
      this.audit_log.record(
        user,
        request.request_type === 'live_patch'
          ? 'publish.live_patch.cancel'
          : 'publish.cancel',
        'publish_request',
        requestId,
        {
          pack_id: request.pack_id,
          version: request.version,
          patch_revision: request.patch_revision,
        },
      );
    })();

    await Promise.all([
      fs.unlink(request.staging_path).catch(() => undefined),
      request.review_artifact_path
        ? fs
            .rm(request.review_artifact_path, { recursive: true, force: true })
            .catch(() => undefined)
        : Promise.resolve(),
    ]);
    return { success: true, request_id: requestId, pack_id: request.pack_id };
  }

  getRequest(id: string, user: AuthUser): PublishRequestView {
    const row = this.requestRow(id);
    const isMaintainer = this.database.db
      .prepare(
        'SELECT 1 FROM pack_maintainers WHERE pack_id = ? AND user_uuid = ?',
      )
      .get(row.pack_id, user.uuid);
    if (
      !isRegistryAdmin(user) &&
      row.submitter_uuid !== user.uuid &&
      !isMaintainer
    )
      throw new NotFoundException('Publish request not found');
    return this.toView(row);
  }

  /**
   * The latest pending request for a pack, regardless of who submitted it —
   * used by the desktop app to show "under review" state for a pack even
   * when a teammate/admin (not the current viewer) submitted it. Returns
   * `null` rather than throwing for a viewer with no stake in the pack
   * (not admin, owner, or submitter): they can't submit for it either, so
   * there's nothing to act on, just no submitter identity to leak.
   */
  getPendingForPack(packId: string, user: AuthUser): PublishRequestView | null {
    const row = this.database.db
      .prepare(
        "SELECT * FROM publish_requests WHERE pack_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      )
      .get(packId) as PublishRequestRow | undefined;
    if (!row) return null;
    const isMaintainer = this.database.db
      .prepare(
        'SELECT 1 FROM pack_maintainers WHERE pack_id = ? AND user_uuid = ?',
      )
      .get(packId, user.uuid);
    const visible =
      isRegistryAdmin(user) ||
      row.submitter_uuid === user.uuid ||
      Boolean(isMaintainer);
    return visible ? this.toView(row) : null;
  }

  canCancel(request: PublishRequestView | null, user: AuthUser): boolean {
    if (!request) return false;
    const row = this.requestRow(request.id);
    return row.status === 'pending' && row.submitter_uuid === user.uuid;
  }

  private toView(row: PublishRequestRow): PublishRequestView {
    return {
      id: row.id,
      pack_id: row.pack_id,
      version: row.version,
      name: row.name,
      description: row.description,
      commit_message: row.commit_message,
      request_type: row.request_type,
      patch_revision: row.patch_revision,
      base_patch_revision: row.base_patch_revision,
      checksum: row.checksum,
      status: row.status,
      validation_json: row.validation_json,
      review_note: row.review_note,
      reviewer_uuid: row.reviewer_uuid,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
    };
  }

  private decodeHistoryCursor(encoded: string): {
    reviewed_at: string;
    id: string;
  } {
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as { reviewed_at?: unknown; id?: unknown };
      if (
        typeof parsed.reviewed_at !== 'string' ||
        !parsed.reviewed_at ||
        typeof parsed.id !== 'string' ||
        !parsed.id
      )
        throw new Error('invalid cursor');
      return { reviewed_at: parsed.reviewed_at, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid history cursor');
    }
  }

  async getStagingZip(
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const request = this.requestRow(requestId);
    if (request.status !== 'pending')
      throw new NotFoundException('Publish request not found');
    const buffer = await fs.readFile(request.staging_path);
    return { buffer, filename: `${request.pack_id}-${request.version}.zip` };
  }

  async getAdminReviewDetail(
    requestId: string,
  ): Promise<AdminPublishReviewDetail> {
    const request = this.adminRequest(requestId);
    let artifactPath = this.requestRow(requestId).review_artifact_path;
    if (!artifactPath && request.status === 'pending') {
      const row = this.requestRow(requestId);
      const zipBytes = await fs.readFile(row.staging_path);
      const built = await this.publishReview.build(
        row.id,
        row.pack_id,
        zipBytes,
        row.base_version ?? undefined,
      );
      this.database.db
        .prepare(
          `UPDATE publish_requests
           SET base_version = ?, review_artifact_path = ?
           WHERE id = ?`,
        )
        .run(built.baseVersion, built.artifactPath, requestId);
      artifactPath = built.artifactPath;
    }
    if (!artifactPath) {
      return {
        ...request,
        base_version: null,
        diff_available: false,
        diff_unavailable_reason:
          'Diff unavailable for reviews completed before browser review was enabled.',
        summary: emptyReviewSummary(),
        files: [],
      };
    }
    try {
      const view = await this.publishReview.view(artifactPath);
      return {
        ...request,
        base_version: view.baseVersion,
        diff_available: true,
        diff_unavailable_reason: null,
        summary: view.summary,
        files: view.files,
      };
    } catch {
      return {
        ...request,
        base_version: this.requestRow(requestId).base_version,
        diff_available: false,
        diff_unavailable_reason: 'The stored review diff is unavailable.',
        summary: emptyReviewSummary(),
        files: [],
      };
    }
  }

  async getAdminReviewFile(
    requestId: string,
    filePath: string,
  ): Promise<PublishReviewFileDetail> {
    await this.getAdminReviewDetail(requestId);
    const artifactPath = this.requestRow(requestId).review_artifact_path;
    if (!artifactPath)
      throw new NotFoundException('Review diff is unavailable');
    return this.publishReview.fileDetail(artifactPath, filePath);
  }

  async getAdminReviewImage(requestId: string, filePath: string, side: string) {
    await this.getAdminReviewDetail(requestId);
    const artifactPath = this.requestRow(requestId).review_artifact_path;
    if (!artifactPath)
      throw new NotFoundException('Review diff is unavailable');
    return this.publishReview.image(artifactPath, filePath, side);
  }

  private assertUploadable(file: UploadedPackFile): void {
    if (!file?.buffer?.length)
      throw new BadRequestException('A pack ZIP is required');
    const max = this.config.value.maxPackUploadBytes;
    if (file.buffer.length > max)
      throw new BadRequestException('Pack ZIP exceeds the upload limit');
  }

  private readEntries(buffer: Buffer): {
    zip: AdmZip;
    entries: AdmZip.IZipEntry[];
  } {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('Invalid ZIP file');
    }
    const entries = zip.getEntries();
    if (!entries.length || entries.length > 5000)
      throw new BadRequestException(
        'ZIP must contain between 1 and 5000 entries',
      );
    let uncompressed = 0;
    for (const entry of entries) {
      const name = entry.entryName.replaceAll('\\', '/');
      if (name.startsWith('/') || name.split('/').includes('..'))
        throw new BadRequestException('ZIP contains an unsafe path');
      uncompressed += entry.header.size;
    }
    if (uncompressed > 500 * 1024 * 1024)
      throw new BadRequestException('Expanded pack exceeds 500 MB');
    return { zip, entries };
  }

  private topLevelRoots(entries: AdmZip.IZipEntry[]): Set<string> {
    return new Set(
      entries.map((entry) => entry.entryName.split('/')[0]).filter(Boolean),
    );
  }

  /**
   * Inspect an uploaded ZIP without staging it. Packs that already contain
   * pack.json report their manifest values; packs that are just loose
   * Markdown files report computed defaults so the admin UI can collect the
   * missing metadata before submission — mirrors the desktop app's
   * `hub_inspect_local_pack` flow.
   */
  inspectUpload(file: UploadedPackFile): LocalPackInspection {
    this.assertUploadable(file);
    const { zip, entries } = this.readEntries(file.buffer);
    const roots = this.topLevelRoots(entries);
    const stringField = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';

    if (roots.size === 1) {
      const root = [...roots][0];
      const manifest = zip.getEntry(`${root}/pack.json`);
      if (manifest) {
        let raw: Record<string, unknown> = {};
        try {
          raw = JSON.parse(manifest.getData().toString('utf8')) as Record<
            string,
            unknown
          >;
        } catch {
          throw new BadRequestException('pack.json is invalid JSON');
        }
        return {
          needs_metadata: false,
          metadata: {
            id: stringField(raw.id) || root,
            name: stringField(raw.name),
            description: stringField(raw.description),
            version: stringField(raw.version),
          },
        };
      }
    }

    const files = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.entryName);
    if (!files.some((file) => file.toLowerCase().endsWith('.md')))
      throw new BadRequestException(
        'Knowledge packs must contain at least one Markdown file',
      );
    const fallbackName =
      (file.originalname ?? '').replace(/\.zip$/i, '').trim() ||
      'knowledge-pack';
    const name = roots.size === 1 ? [...roots][0] : fallbackName;
    return {
      needs_metadata: true,
      metadata: {
        id: slugifyPackId(name),
        name,
        description: '',
        version: '1.0.0',
      },
    };
  }

  /**
   * Validates a ZIP and returns the pack metadata alongside the buffer that
   * should actually be staged. When the ZIP has no pack.json, `metadata`
   * (collected via `inspectUpload` + admin UI edits) is used to synthesize
   * one and the ZIP is rebuilt with it, so everything downstream (staging,
   * review diff, checksum, and the re-validation in `approve()`) sees a
   * normal, self-contained pack ZIP.
   */
  private validateZip(
    buffer: Buffer,
    metadata?: KnowledgePackMeta,
  ): { pack: ValidatedPack; buffer: Buffer } {
    const { zip, entries } = this.readEntries(buffer);
    const roots = this.topLevelRoots(entries);
    const stringField = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';

    if (roots.size === 1) {
      const root = [...roots][0];
      const manifest = zip.getEntry(`${root}/pack.json`);
      if (manifest) {
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(manifest.getData().toString('utf8')) as Record<
            string,
            unknown
          >;
        } catch {
          throw new BadRequestException('pack.json is invalid JSON');
        }
        const id = stringField(raw.id);
        const name = stringField(raw.name);
        const description = stringField(raw.description);
        const version = stringField(raw.version);
        if (!isValidPackId(id) || id !== root)
          throw new BadRequestException(
            'pack.json id must match the top-level folder and use a valid pack ID',
          );
        if (!name) throw new BadRequestException('pack.json name is required');
        if (!isValidSemVer(version))
          throw new BadRequestException(
            'pack.json version must be valid SemVer',
          );
        if (raw.path != null && stringField(raw.path) !== id)
          throw new BadRequestException('pack.json path must equal id');
        const files = entries
          .filter((entry) => !entry.isDirectory)
          .map((entry) => entry.entryName);
        if (!files.some((file) => file.toLowerCase().endsWith('.md')))
          throw new BadRequestException(
            'Knowledge packs must contain at least one Markdown file',
          );
        return { pack: { id, name, description, version, files }, buffer };
      }
    }

    if (!metadata)
      throw new BadRequestException('pack.json is required at the pack root');
    const id = stringField(metadata.id);
    const name = stringField(metadata.name);
    const description = stringField(metadata.description);
    const version = stringField(metadata.version);
    if (!isValidPackId(id))
      throw new BadRequestException(
        'Pack ID must use lowercase or Unicode letters, numbers, and hyphens',
      );
    if (!name) throw new BadRequestException('Pack name is required');
    if (!isValidSemVer(version))
      throw new BadRequestException('Pack version must be valid SemVer');

    const contentPrefix = roots.size === 1 ? `${[...roots][0]}/` : '';
    const rebuilt = new AdmZip();
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const relative =
        contentPrefix && entry.entryName.startsWith(contentPrefix)
          ? entry.entryName.slice(contentPrefix.length)
          : entry.entryName;
      if (!relative) continue;
      rebuilt.addFile(`${id}/${relative}`, entry.getData());
    }
    const manifestJson = `${JSON.stringify(
      { id, name, description, version },
      null,
      2,
    )}\n`;
    rebuilt.addFile(`${id}/pack.json`, Buffer.from(manifestJson, 'utf8'));
    const files = rebuilt
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.entryName);
    if (!files.some((file) => file.toLowerCase().endsWith('.md')))
      throw new BadRequestException(
        'Knowledge packs must contain at least one Markdown file',
      );
    return {
      pack: { id, name, description, version, files },
      buffer: rebuilt.toBuffer(),
    };
  }

  private async readReleaseManifest(
    packId: string,
    version: string,
  ): Promise<ValidatedPack> {
    const manifestPath = path.join(
      this.config.value.registryPath,
      packId,
      version,
      'pack.json',
    );
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new ConflictException('Target release metadata is unavailable');
    }
    const stringField = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';
    const id = stringField(raw.id);
    const name = stringField(raw.name);
    const description = stringField(raw.description);
    const manifestVersion = stringField(raw.version);
    const manifestPathField = stringField(raw.path) || id;
    if (
      id !== packId ||
      manifestVersion !== version ||
      manifestPathField !== id ||
      !name
    )
      throw new ConflictException('Target release metadata is invalid');
    return {
      id,
      name,
      description,
      version: manifestVersion,
      files: [],
    };
  }

  private requestRow(id: string): PublishRequestRow {
    const row = this.database.db
      .prepare('SELECT * FROM publish_requests WHERE id = ?')
      .get(id) as PublishRequestRow | undefined;
    if (!row) throw new NotFoundException('Publish request not found');
    return row;
  }

  private adminRequest(id: string): AdminPublishRequest {
    const row = this.database.db
      .prepare(
        `SELECT
          r.id, r.pack_id, r.version, r.name, r.description, r.commit_message, r.status,
          r.request_type, r.patch_revision, r.base_patch_revision,
          r.checksum, r.validation_json, r.review_note, r.created_at,
          r.reviewed_at,
          COALESCE(r.submitter_id_snapshot, submitter.login_id) AS submitter_id,
          COALESCE(r.submitter_name_snapshot, submitter.name) AS submitter_name,
          COALESCE(r.reviewer_id_snapshot, reviewer.login_id) AS reviewer_id,
          COALESCE(r.reviewer_name_snapshot, reviewer.name) AS reviewer_name
        FROM publish_requests r
        LEFT JOIN users submitter ON submitter.uuid = r.submitter_uuid
        LEFT JOIN users reviewer ON reviewer.uuid = r.reviewer_uuid
        WHERE r.id = ?`,
      )
      .get(id) as AdminPublishRequest | undefined;
    if (!row) throw new NotFoundException('Publish request not found');
    return row;
  }
}

function emptyReviewSummary() {
  return {
    changed_files: 0,
    added_files: 0,
    modified_files: 0,
    deleted_files: 0,
    additions: 0,
    deletions: 0,
  };
}
