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
import type { PendingPublishRequest, PublishRequestStatus } from '@nest/shared';

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
  created_at: string;
  reviewed_at: string | null;
};
export type PublishRequestView = Omit<
  PublishRequestRow,
  'staging_path' | 'submitter_uuid'
>;
export type PendingRequestView = PendingPublishRequest;

@Injectable()
export class PublishingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: HubRuntimeConfig,
    private readonly messages: MessagesService,
    private readonly audit_log: AuditService,
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
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const timestamp = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO publish_requests(id, pack_id, version, name, description, submitter_uuid, staging_path, checksum, status, validation_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        requestId,
        pack.id,
        pack.version,
        pack.name,
        pack.description,
        user.uuid,
        stagingPath,
        checksum,
        JSON.stringify({ files: pack.files }),
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

  async approve(
    requestId: string,
    reviewer: AuthUser,
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
            "UPDATE publish_requests SET status = 'approved', reviewer_uuid = ?, reviewed_at = ? WHERE id = ?",
          )
          .run(reviewer.uuid, timestamp, requestId);
        this.audit_log.record(
          reviewer,
          'publish.approve',
          'publish_request',
          requestId,
          {
            pack_id: validated.id,
            version: validated.version,
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
            body: `${validated.name} ${validated.version} was approved and released to the Hub.`,
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
          "UPDATE publish_requests SET status = 'rejected', review_note = ?, reviewer_uuid = ?, reviewed_at = ? WHERE id = ?",
        )
        .run(note.trim(), reviewer.uuid, timestamp, requestId);
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
    if (!isRegistryAdmin(user) && row.submitter_uuid !== user.uuid)
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
    const pack = this.database.db
      .prepare('SELECT owner_uuid FROM packs WHERE id = ?')
      .get(packId) as { owner_uuid: string | null } | undefined;
    const visible =
      isRegistryAdmin(user) ||
      row.submitter_uuid === user.uuid ||
      pack?.owner_uuid === user.uuid;
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

  async getStagingZip(
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const request = this.requestRow(requestId);
    if (request.status !== 'pending')
      throw new NotFoundException('Publish request not found');
    const buffer = await fs.readFile(request.staging_path);
    return { buffer, filename: `${request.pack_id}-${request.version}.zip` };
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
}
