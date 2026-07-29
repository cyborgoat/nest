import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
import { isValidSemVer } from '../packs/semver';
import type {
  AdminPublishReviewDetail,
  AdminPublishHistoryPage,
  AdminPublishRequest,
  PendingPublishRequest,
  PublishReviewFileDetail,
  PublishRequestStatus,
} from '@nest/shared';
import { PublishReviewService } from './publish-review.service';

const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
  constructor(
    private readonly database: DatabaseService,
    private readonly config: HubRuntimeConfig,
    private readonly messages: MessagesService,
    private readonly audit_log: AuditService,
    private readonly publishReview: PublishReviewService,
  ) {}

  async submit(
    user: AuthUser,
    file: UploadedPackFile,
  ): Promise<PublishRequestView> {
    if (!file?.buffer?.length)
      throw new BadRequestException('A pack ZIP is required');
    const max = this.config.value.maxPackUploadBytes;
    if (file.buffer.length > max)
      throw new BadRequestException('Pack ZIP exceeds the upload limit');
    const pack = this.validateZip(file.buffer);
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
    if (
      db
        .prepare('SELECT 1 FROM releases WHERE pack_id = ? AND version = ?')
        .get(pack.id, pack.version)
    ) {
      throw new ConflictException(
        `Pack release already exists: ${pack.id}@${pack.version}`,
      );
    }
    const stagingRoot = this.config.value.stagingPath;
    mkdirSync(stagingRoot, { recursive: true });
    const requestId = randomUUID();
    const stagingPath = path.join(stagingRoot, `${requestId}.zip`);
    await fs.writeFile(stagingPath, file.buffer);
    let reviewArtifact: Awaited<ReturnType<PublishReviewService['build']>>;
    try {
      reviewArtifact = await this.publishReview.build(
        requestId,
        pack.id,
        file.buffer,
      );
    } catch (error) {
      await fs.unlink(stagingPath).catch(() => undefined);
      throw error;
    }
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const timestamp = now();
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO publish_requests(
            id, pack_id, version, name, description, submitter_uuid,
            submitter_id_snapshot, submitter_name_snapshot, staging_path,
            checksum, status, validation_json, base_version,
            review_artifact_path, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        ).run(
          requestId,
          pack.id,
          pack.version,
          pack.name,
          pack.description,
          user.uuid,
          user.id,
          user.name,
          stagingPath,
          checksum,
          JSON.stringify({ files: pack.files }),
          reviewArtifact.baseVersion,
          reviewArtifact.artifactPath,
          timestamp,
        );
        this.messages.create({
          userUuid: user.uuid,
          kind: 'publish_submitted',
          title: 'Publish request submitted',
          body: `${pack.name} ${pack.version} is waiting for review.`,
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
    return this.getRequest(requestId, user);
  }

  listMine(user: AuthUser): PublishRequestView[] {
    return this.database.db
      .prepare(
        `SELECT id, pack_id, version, name, description, status, review_note, created_at, reviewed_at
      FROM publish_requests WHERE submitter_uuid = ? ORDER BY created_at DESC`,
      )
      .all(user.uuid) as PublishRequestView[];
  }

  listPending(): PendingRequestView[] {
    return this.database.db
      .prepare(
        `SELECT r.id, r.pack_id, r.version, r.name, r.description, r.status, r.checksum,
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
          r.id, r.pack_id, r.version, r.name, r.description, r.status,
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
    const validated = this.validateZip(zipBytes);
    const root = this.config.value.registryPath;
    const projectDir = path.join(root, validated.id);
    const destination = path.join(projectDir, validated.version);
    if (
      await fs
        .stat(destination)
        .then(() => true)
        .catch(() => false)
    )
      throw new ConflictException('Release directory already exists');
    const extractRoot = path.join(
      path.dirname(request.staging_path),
      `${request.id}-extract`,
    );
    await fs.rm(extractRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });
    new AdmZip(zipBytes).extractAllTo(extractRoot, true);
    mkdirSync(projectDir, { recursive: true });
    await fs.rename(path.join(extractRoot, validated.id), destination);
    await fs.rm(extractRoot, { recursive: true, force: true });
    const timestamp = now();
    try {
      this.database.db.transaction(() => {
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
        this.database.db
          .prepare(
            `UPDATE publish_requests
             SET status = 'approved', review_note = ?, reviewer_uuid = ?,
                 reviewer_id_snapshot = ?, reviewer_name_snapshot = ?,
                 reviewed_at = ?
             WHERE id = ?`,
          )
          .run(
            note?.trim() || null,
            reviewer.uuid,
            reviewer.id,
            reviewer.name,
            timestamp,
            requestId,
          );
        this.audit_log.record(
          reviewer,
          'publish.approve',
          'publish_request',
          requestId,
          {
            pack_id: validated.id,
            version: validated.version,
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
            title: 'Knowledge pack published',
            body: `${validated.name} ${validated.version} was approved and released to the Hub.${
              note?.trim() ? ` Reviewer comment: ${note.trim()}` : ''
            }`,
            packId: validated.id,
            publishRequestId: requestId,
            eventKey: `publish:${requestId}:approved`,
            createdAt: timestamp,
          });
        }
      })();
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      throw error;
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
      this.database.db
        .prepare(
          `UPDATE publish_requests
           SET status = 'rejected', review_note = ?, reviewer_uuid = ?,
               reviewer_id_snapshot = ?, reviewer_name_snapshot = ?,
               reviewed_at = ?
           WHERE id = ?`,
        )
        .run(
          note.trim(),
          reviewer.uuid,
          reviewer.id,
          reviewer.name,
          timestamp,
          requestId,
        );
      this.audit_log.record(
        reviewer,
        'publish.reject',
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
          title: 'Publish request needs changes',
          body: `${request.name} ${request.version} was not approved: ${note.trim()}`,
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

  private toView(row: PublishRequestRow): PublishRequestView {
    return {
      id: row.id,
      pack_id: row.pack_id,
      version: row.version,
      name: row.name,
      description: row.description,
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

  private validateZip(buffer: Buffer): ValidatedPack {
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
    const roots = new Set(
      entries.map((entry) => entry.entryName.split('/')[0]).filter(Boolean),
    );
    if (roots.size !== 1)
      throw new BadRequestException(
        'ZIP must contain exactly one top-level pack folder',
      );
    const root = [...roots][0];
    const manifest = zip.getEntry(`${root}/pack.json`);
    if (!manifest)
      throw new BadRequestException('pack.json is required at the pack root');
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(manifest.getData().toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new BadRequestException('pack.json is invalid JSON');
    }
    const stringField = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';
    const id = stringField(raw.id);
    const name = stringField(raw.name);
    const description = stringField(raw.description);
    const version = stringField(raw.version);
    if (!PACK_ID_RE.test(id) || id !== root)
      throw new BadRequestException(
        'pack.json id must match the top-level folder and use a valid pack ID',
      );
    if (!name) throw new BadRequestException('pack.json name is required');
    if (!isValidSemVer(version))
      throw new BadRequestException('pack.json version must be valid SemVer');
    if (raw.path != null && stringField(raw.path) !== id)
      throw new BadRequestException('pack.json path must equal id');
    const files = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.entryName);
    if (!files.some((file) => file.toLowerCase().endsWith('.md')))
      throw new BadRequestException(
        'Knowledge packs must contain at least one Markdown file',
      );
    return { id, name, description, version, files };
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
          r.id, r.pack_id, r.version, r.name, r.description, r.status,
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
