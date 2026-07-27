import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
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
import type { PackProject, PackRelease } from './pack.types';
import { isValidSemVer, sortSemVerDesc } from './semver';

const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PackZipArtifact = {
  filePath: string;
  filename: string;
  sha256: string;
  byteLength: number;
};

export type CreatePackZipOptions = {
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

@Injectable()
export class PacksService implements OnModuleInit {
  private readonly logger = new Logger(PacksService.name);

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

  async listReleases(
    user?: AuthUser,
    includeArchived = false,
  ): Promise<PackRelease[]> {
    await this.syncRegistry();
    const rows = this.database.db
      .prepare(
        `
      SELECT r.pack_id AS id, p.name, p.description, r.version, r.yanked
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
    }>;
    return rows.map((row) => ({
      ...row,
      path: row.id,
      yanked: row.yanked === 1,
    }));
  }

  private projectFromReleases(
    releases: PackRelease[],
  ): Omit<PackProject, 'visibility' | 'owner_id'> | null {
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
        // owner_id is resolved per-requester: the caller's own login id when
        // they're one of the pack's maintainers, else null. There is no
        // single "the owner" anymore now that packs support multiple
        // maintainers — this field only ever answers "can *I* edit this."
        const row = this.database.db
          .prepare(
            `SELECT visibility, EXISTS (
              SELECT 1 FROM pack_maintainers m WHERE m.pack_id = packs.id AND m.user_uuid = ?
            ) AS is_maintainer FROM packs WHERE id = ?`,
          )
          .get(user?.uuid ?? '', id) as {
          visibility: 'public' | 'restricted';
          is_maintainer: number;
        };
        projects.push({
          ...project,
          visibility: row.visibility,
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
    return release;
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

      return { filePath, filename, sha256, byteLength };
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
