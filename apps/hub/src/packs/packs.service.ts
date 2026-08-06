import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { HubRuntimeConfig } from '../hub.config';
import { DatabaseService } from '../database/database.service';
import { isRegistryAdmin } from '../auth/access-policy';
import type { AuthUser } from '../auth/auth.types';
import type { RegistryResyncIssue, RegistryResyncResult } from '@nest/shared';
import type { PackProject, PackRelease } from './pack.types';
import { isValidSemVer, sortSemVerDesc } from './semver';

const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PackZipArtifact = {
  filePath: string;
  filename: string;
  sha256: string;
  byteLength: number;
  patchRevision: number;
};

type CreatePackZipOptions = {
  /** Administrative archive retrieval may include releases hidden from users. */
  allowYanked?: boolean;
};

type RawPackJson = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  path?: string;
  yanked?: boolean;
};

type ScannedRelease = PackRelease & {
  manifestModifiedAt: string;
};

type RegistryScan = {
  projectDirectories: Set<string>;
  unreadableProjects: Set<string>;
  releaseDirectories: Set<string>;
  releases: ScannedRelease[];
  issues: RegistryResyncIssue[];
};

@Injectable()
export class PacksService implements OnModuleInit {
  private readonly logger = new Logger(PacksService.name);
  private registryReconcile: Promise<RegistryResyncResult> | null = null;

  constructor(
    private readonly config: HubRuntimeConfig,
    private readonly database: DatabaseService,
  ) {}

  async onModuleInit() {
    await this.syncRegistry();
  }

  private debug(message: string) {
    if (this.config.value.debug) {
      this.logger.debug(message);
    }
  }

  private registryRoot(): string {
    return this.config.value.registryPath;
  }

  private async readRelease(
    projectId: string,
    version: string,
    versionDir: string,
  ): Promise<PackRelease | null> {
    const metaPath = path.join(versionDir, 'pack.json');
    if (!existsSync(metaPath)) {
      return null;
    }
    const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as RawPackJson;
    const id = (raw.id ?? '').trim();
    const name = (raw.name ?? '').trim();
    const packVersion = (raw.version ?? '').trim();
    const description = (raw.description ?? '').trim();
    const pathField = (raw.path ?? id).trim() || id;

    if (!id || !name || !packVersion) {
      throw new Error(
        `Invalid pack.json in ${versionDir}: id, name, and version are required`,
      );
    }
    if (id !== projectId) {
      throw new Error(
        `pack.json id "${id}" does not match project folder "${projectId}"`,
      );
    }
    if (packVersion !== version) {
      throw new Error(
        `pack.json version "${packVersion}" does not match folder "${version}"`,
      );
    }
    if (!isValidSemVer(packVersion)) {
      throw new Error(`Invalid SemVer in ${versionDir}: ${packVersion}`);
    }
    if (pathField !== id) {
      throw new Error(
        `pack.json path "${pathField}" must equal id "${id}" (or be omitted)`,
      );
    }

    return {
      id,
      name,
      description,
      version: packVersion,
      path: id,
      yanked: raw.yanked === true,
      patch_revision: 0,
      patched_at: null,
    };
  }

  /** Scan registry: {id}/{version}/pack.json */
  private async scanReleases(): Promise<PackRelease[]> {
    const root = this.registryRoot();
    this.debug(`listReleases registry=${root}`);
    if (!existsSync(root)) {
      this.logger.warn(`Registry path does not exist: ${root}`);
      return [];
    }

    const releases: PackRelease[] = [];
    const projects = await fs.readdir(root, { withFileTypes: true });
    for (const project of projects.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!project.isDirectory() || project.name.startsWith('.')) {
        continue;
      }
      if (!PACK_ID_RE.test(project.name)) {
        this.logger.warn(`Skipping invalid project id folder: ${project.name}`);
        continue;
      }
      const projectDir = path.join(root, project.name);
      const versionEntries = await fs.readdir(projectDir, {
        withFileTypes: true,
      });
      for (const ver of versionEntries) {
        if (!ver.isDirectory() || ver.name.startsWith('.')) {
          continue;
        }
        if (!isValidSemVer(ver.name)) {
          this.logger.warn(
            `Skipping non-SemVer folder ${project.name}/${ver.name}`,
          );
          continue;
        }
        try {
          const release = await this.readRelease(
            project.name,
            ver.name,
            path.join(projectDir, ver.name),
          );
          if (release) {
            releases.push(release);
          }
        } catch (e) {
          this.logger.warn(
            `Skipping ${project.name}/${ver.name}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    }
    this.debug(`listReleases count=${releases.length}`);
    return releases;
  }

  /** Import filesystem-only releases as public catalog records. Idempotent. */
  async syncRegistry(): Promise<void> {
    const releases = await this.scanReleases();
    const timestamp = new Date().toISOString();
    const db = this.database.db;
    const insertPack =
      db.prepare(`INSERT OR IGNORE INTO packs(id, name, description, visibility, archived, created_at, updated_at)
      VALUES (?, ?, ?, 'public', 0, ?, ?)`);
    const insertRelease =
      db.prepare(`INSERT OR IGNORE INTO releases(pack_id, version, storage_path, yanked, published_at)
      VALUES (?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const release of releases) {
        insertPack.run(
          release.id,
          release.name,
          release.description,
          timestamp,
          timestamp,
        );
        insertRelease.run(
          release.id,
          release.version,
          path.join(release.id, release.version),
          release.yanked ? 1 : 0,
          timestamp,
        );
      }
    })();
  }

  /**
   * Reconcile database catalog rows with the registry directory. Unlike the
   * additive startup sync, this is an explicit administrative operation and
   * therefore also removes rows whose directories were manually removed.
   */
  reconcileRegistry(): Promise<RegistryResyncResult> {
    if (this.registryReconcile) return this.registryReconcile;
    this.registryReconcile = this.performRegistryReconciliation().finally(
      () => {
        this.registryReconcile = null;
      },
    );
    return this.registryReconcile;
  }

  private async scanRegistryForReconciliation(): Promise<RegistryScan> {
    const root = this.registryRoot();
    const projects = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => {
        throw new ServiceUnavailableException(
          'The knowledge-pack registry folder is unavailable.',
        );
      });
    const scan: RegistryScan = {
      projectDirectories: new Set(),
      unreadableProjects: new Set(),
      releaseDirectories: new Set(),
      releases: [],
      issues: [],
    };

    for (const project of projects.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!project.isDirectory() || project.name.startsWith('.')) continue;
      if (!PACK_ID_RE.test(project.name)) {
        scan.issues.push({
          path: project.name,
          message: 'Pack folder name must be a lowercase, hyphenated pack ID.',
        });
        continue;
      }
      scan.projectDirectories.add(project.name);
      const projectDir = path.join(root, project.name);
      let versions;
      try {
        versions = await fs.readdir(projectDir, { withFileTypes: true });
      } catch (error) {
        scan.unreadableProjects.add(project.name);
        const message = error instanceof Error ? error.message : String(error);
        scan.issues.push({
          path: project.name,
          message: `Could not read pack folder: ${message.replaceAll(
            projectDir,
            project.name,
          )}`,
        });
        continue;
      }

      for (const version of versions.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!version.isDirectory() || version.name.startsWith('.')) continue;
        const relativePath = path.posix.join(project.name, version.name);
        if (!isValidSemVer(version.name)) {
          scan.issues.push({
            path: relativePath,
            message: 'Release folder name must be a valid semantic version.',
          });
          continue;
        }
        scan.releaseDirectories.add(`${project.name}@${version.name}`);
        const versionDir = path.join(projectDir, version.name);
        try {
          const release = await this.readRelease(
            project.name,
            version.name,
            versionDir,
          );
          if (!release) {
            scan.issues.push({
              path: relativePath,
              message: 'Release folder is missing pack.json.',
            });
            continue;
          }
          const manifest = await fs.stat(path.join(versionDir, 'pack.json'));
          scan.releases.push({
            ...release,
            manifestModifiedAt: manifest.mtime.toISOString(),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          scan.issues.push({
            path: relativePath,
            message: message.replaceAll(versionDir, relativePath),
          });
        }
      }
    }
    return scan;
  }

  private async performRegistryReconciliation(): Promise<RegistryResyncResult> {
    const scan = await this.scanRegistryForReconciliation();
    const completedAt = new Date().toISOString();
    const result: RegistryResyncResult = {
      completed_at: completedAt,
      packs_added: [],
      packs_updated: [],
      packs_removed: [],
      releases_added: [],
      releases_updated: [],
      releases_removed: [],
      issues: scan.issues,
    };
    const db = this.database.db;
    const existingPacks = db
      .prepare('SELECT id, name, description FROM packs')
      .all() as Array<{ id: string; name: string; description: string }>;
    const existingReleases = db
      .prepare('SELECT pack_id, version, storage_path FROM releases')
      .all() as Array<{
      pack_id: string;
      version: string;
      storage_path: string;
    }>;
    const packRows = new Map(existingPacks.map((pack) => [pack.id, pack]));
    const releaseRows = new Map(
      existingReleases.map((release) => [
        `${release.pack_id}@${release.version}`,
        release,
      ]),
    );
    const releasesByPack = new Map<string, ScannedRelease[]>();
    for (const release of scan.releases) {
      const releases = releasesByPack.get(release.id) ?? [];
      releases.push(release);
      releasesByPack.set(release.id, releases);
    }

    db.transaction(() => {
      for (const pack of existingPacks) {
        if (scan.projectDirectories.has(pack.id)) continue;
        result.packs_removed.push(pack.id);
        for (const release of existingReleases) {
          if (release.pack_id === pack.id) {
            result.releases_removed.push(
              `${release.pack_id}@${release.version}`,
            );
          }
        }
        db.prepare('DELETE FROM packs WHERE id = ?').run(pack.id);
      }

      for (const release of existingReleases) {
        if (!scan.projectDirectories.has(release.pack_id)) continue;
        if (scan.unreadableProjects.has(release.pack_id)) continue;
        const key = `${release.pack_id}@${release.version}`;
        if (scan.releaseDirectories.has(key)) continue;
        result.releases_removed.push(key);
        db.prepare(
          'DELETE FROM releases WHERE pack_id = ? AND version = ?',
        ).run(release.pack_id, release.version);
      }

      for (const [packId, releases] of releasesByPack) {
        const latestVersion = sortSemVerDesc(
          releases.map((release) => release.version),
        )[0];
        const latest = releases.find(
          (release) => release.version === latestVersion,
        )!;
        const existing = packRows.get(packId);
        if (!existing) {
          db.prepare(
            `INSERT INTO packs(id, name, description, visibility, archived, created_at, updated_at)
             VALUES (?, ?, ?, 'public', 0, ?, ?)`,
          ).run(
            packId,
            latest.name,
            latest.description,
            completedAt,
            completedAt,
          );
          result.packs_added.push(packId);
        } else if (
          existing.name !== latest.name ||
          existing.description !== latest.description
        ) {
          db.prepare(
            'UPDATE packs SET name = ?, description = ?, updated_at = ? WHERE id = ?',
          ).run(latest.name, latest.description, completedAt, packId);
          result.packs_updated.push(packId);
        }
      }

      for (const release of scan.releases) {
        const key = `${release.id}@${release.version}`;
        const storagePath = path.join(release.id, release.version);
        const existing = releaseRows.get(key);
        if (!existing) {
          db.prepare(
            `INSERT INTO releases(pack_id, version, storage_path, yanked, published_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(
            release.id,
            release.version,
            storagePath,
            release.yanked ? 1 : 0,
            release.manifestModifiedAt,
          );
          result.releases_added.push(key);
        } else if (existing.storage_path !== storagePath) {
          db.prepare(
            'UPDATE releases SET storage_path = ? WHERE pack_id = ? AND version = ?',
          ).run(storagePath, release.id, release.version);
          result.releases_updated.push(key);
        }
      }
    })();

    for (const values of [
      result.packs_added,
      result.packs_updated,
      result.packs_removed,
      result.releases_added,
      result.releases_updated,
      result.releases_removed,
    ]) {
      values.sort();
    }
    return result;
  }

  async listReleases(
    user?: AuthUser,
    includeArchived = false,
  ): Promise<PackRelease[]> {
    await this.syncRegistry();
    const rows = this.database.db
      .prepare(
        `
      SELECT r.pack_id AS id, p.name, p.description, r.version, r.yanked,
             r.patch_revision, r.patched_at
      FROM releases r JOIN packs p ON p.id = r.pack_id
      WHERE (? = 1 OR p.archived = 0)
        AND (? = 1 OR p.visibility = 'public' OR EXISTS (
          SELECT 1 FROM pack_access a WHERE a.pack_id = p.id AND a.user_uuid = ?
        ) OR EXISTS (
          SELECT 1 FROM pack_maintainers m WHERE m.pack_id = p.id AND m.user_uuid = ?
        ))
    `,
      )
      .all(
        includeArchived ? 1 : 0,
        isRegistryAdmin(user) ? 1 : 0,
        user?.uuid ?? '',
        user?.uuid ?? '',
      ) as Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      yanked: number;
      patch_revision: number;
      patched_at: string | null;
    }>;
    return rows.map((row) => ({
      ...row,
      path: row.id,
      yanked: row.yanked === 1,
    }));
  }

  private projectFromReleases(
    releases: PackRelease[],
  ): Omit<
    PackProject,
    'visibility' | 'owner_id' | 'author' | 'maintainers'
  > | null {
    if (releases.length === 0) return null;
    const installable = releases.filter((r) => !r.yanked);
    const versions = sortSemVerDesc(releases.map((r) => r.version));
    const latestPool = installable.length > 0 ? installable : releases;
    const latest = sortSemVerDesc(latestPool.map((r) => r.version))[0];
    const latestMeta =
      latestPool.find((r) => r.version === latest) ?? releases[0];
    return {
      id: latestMeta.id,
      name: latestMeta.name,
      description: latestMeta.description,
      latest_version: latest,
      versions,
      releases: versions.map((version) => {
        const release = releases.find(
          (candidate) => candidate.version === version,
        )!;
        return {
          version,
          yanked: release.yanked,
          patch_revision: release.patch_revision,
          patched_at: release.patched_at,
        };
      }),
    };
  }

  async listProjects(
    user?: AuthUser,
    includeArchived = false,
  ): Promise<PackProject[]> {
    const releases = await this.listReleases(user, includeArchived);
    const byId = new Map<string, PackRelease[]>();
    for (const r of releases) {
      const list = byId.get(r.id) ?? [];
      list.push(r);
      byId.set(r.id, list);
    }
    const projects: PackProject[] = [];
    for (const id of [...byId.keys()].sort()) {
      const project = this.projectFromReleases(byId.get(id)!);
      if (project) {
        // author is stable public attribution. owner_id remains a personalized
        // compatibility field that answers only whether this requester is a
        // maintainer and can edit the pack.
        const row = this.database.db
          .prepare(
            `SELECT p.visibility,
                    author.login_id AS author_id,
                    author.name AS author_name,
                    EXISTS (
              SELECT 1 FROM pack_maintainers m WHERE m.pack_id = p.id AND m.user_uuid = ?
            ) AS is_maintainer
             FROM packs p
             LEFT JOIN users author ON author.uuid = p.owner_uuid
             WHERE p.id = ?`,
          )
          .get(user?.uuid ?? '', id) as {
          visibility: 'public' | 'restricted';
          author_id: string | null;
          author_name: string | null;
          is_maintainer: number;
        };
        const maintainers = this.database.db
          .prepare(
            `SELECT u.login_id AS id, u.name
             FROM pack_maintainers m
             JOIN users u ON u.uuid = m.user_uuid
             WHERE m.pack_id = ?
             ORDER BY u.name COLLATE NOCASE, u.login_id COLLATE NOCASE`,
          )
          .all(id) as Array<{ id: string; name: string }>;
        projects.push({
          ...project,
          visibility: row.visibility,
          author:
            row.author_id && row.author_name
              ? { id: row.author_id, name: row.author_name }
              : null,
          maintainers,
          owner_id: row.is_maintainer && user ? user.id : null,
        });
      }
    }
    return projects;
  }

  async getProject(packId: string, user?: AuthUser): Promise<PackProject> {
    const projects = await this.listProjects(user);
    const found = projects.find((project) => project.id === packId);
    if (found) return found;
    throw new NotFoundException(`Pack not found: ${packId}`);
  }

  async getRelease(
    packId: string,
    version: string,
    user?: AuthUser,
  ): Promise<PackRelease> {
    if (!isValidSemVer(version)) {
      throw new BadRequestException(`Invalid SemVer: ${version}`);
    }
    const release = (await this.listReleases(user)).find(
      (r) => r.id === packId && r.version === version,
    );
    if (!release) {
      throw new NotFoundException(`Pack not found: ${packId}@${version}`);
    }
    const manifestRelease = await this.readRelease(
      packId,
      version,
      path.join(this.registryRoot(), packId, version),
    );
    if (!manifestRelease) {
      throw new NotFoundException(
        `Pack manifest not found: ${packId}@${version}`,
      );
    }
    return {
      ...manifestRelease,
      yanked: release.yanked,
      patch_revision: release.patch_revision,
      patched_at: release.patched_at,
    };
  }

  /**
   * Build a pack ZIP on disk (temp file) for streaming. Caller must delete
   * `filePath` after the response finishes.
   */
  async createPackZip(
    packId: string,
    version?: string,
    user?: AuthUser,
    options: CreatePackZipOptions = {},
  ): Promise<PackZipArtifact> {
    const started = Date.now();
    let release: PackRelease;
    if (version) {
      release = await this.getRelease(packId, version, user);
      if (release.yanked && !options.allowYanked) {
        throw new NotFoundException(
          `Pack version yanked: ${packId}@${version}`,
        );
      }
    } else {
      const project = await this.getProject(packId, user);
      release = await this.getRelease(packId, project.latest_version, user);
      if (release.yanked) {
        throw new NotFoundException(
          `No installable version for pack: ${packId}`,
        );
      }
    }

    const packDir = path.join(this.registryRoot(), release.id, release.version);
    this.debug(
      `createPackZip start id=${packId} version=${release.version} dir=${packDir}`,
    );
    if (!existsSync(packDir)) {
      this.logger.error(
        `Pack directory missing for download: ${packId}@${release.version} path=${packDir}`,
      );
      throw new NotFoundException(
        `Pack directory missing: ${packId}@${release.version}`,
      );
    }

    const filename = `${release.id}-${release.version}.zip`;
    const filePath = path.join(
      os.tmpdir(),
      `nest-hub-${release.id}-${release.version}-${randomUUID()}.zip`,
    );

    try {
      const zip = new AdmZip();
      zip.addLocalFolder(packDir, release.id);
      zip.writeZip(filePath);

      const stat = await fs.stat(filePath);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk as Buffer);
      }
      const sha256 = hash.digest('hex');
      const byteLength = stat.size;
      const elapsedMs = Date.now() - started;

      this.debug(
        `createPackZip done id=${packId} version=${release.version} bytes=${byteLength} sha256=${sha256.slice(0, 12)}… elapsedMs=${elapsedMs} file=${filePath}`,
      );

      return {
        filePath,
        filename,
        sha256,
        byteLength,
        patchRevision: release.patch_revision,
      };
    } catch (e) {
      await fs.unlink(filePath).catch(() => undefined);
      this.logger.error(
        `createPackZip failed id=${packId} version=${release.version} dir=${packDir}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw e;
    }
  }

  openZipStream(filePath: string) {
    return createReadStream(filePath);
  }

  async cleanupZipFile(filePath: string) {
    await fs.unlink(filePath).catch(() => undefined);
  }
}
