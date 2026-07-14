import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { PackProject, PackRelease } from './pack.types';
import { isValidSemVer, sortSemVerDesc } from './semver';

const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nestDebugEnabled(config: ConfigService): boolean {
  const v = (config.get<string>('NEST_DEBUG') ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

type RawPackJson = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  path?: string;
  yanked?: boolean;
};

@Injectable()
export class PacksService {
  private readonly logger = new Logger(PacksService.name);

  constructor(private readonly config: ConfigService) {}

  private debug(message: string) {
    if (nestDebugEnabled(this.config)) {
      this.logger.debug(message);
    }
  }

  private fixturesRoot(): string {
    const configured = this.config.get<string>('FIXTURES_PATH');
    if (!configured) {
      throw new Error(
        'FIXTURES_PATH is not set. Copy .env.example to .env and configure it.',
      );
    }
    return path.resolve(process.cwd(), configured);
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
  async listReleases(): Promise<PackRelease[]> {
    const root = this.fixturesRoot();
    this.debug(`listReleases root=${root}`);
    if (!existsSync(root)) {
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

  private projectFromReleases(releases: PackRelease[]): PackProject | null {
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

  async listProjects(): Promise<PackProject[]> {
    const releases = await this.listReleases();
    const byId = new Map<string, PackRelease[]>();
    for (const r of releases) {
      const list = byId.get(r.id) ?? [];
      list.push(r);
      byId.set(r.id, list);
    }
    const projects: PackProject[] = [];
    for (const id of [...byId.keys()].sort()) {
      const project = this.projectFromReleases(byId.get(id)!);
      if (project) projects.push(project);
    }
    return projects;
  }

  async getProject(packId: string): Promise<PackProject> {
    const releases = (await this.listReleases()).filter((r) => r.id === packId);
    const project = this.projectFromReleases(releases);
    if (!project) {
      throw new NotFoundException(`Pack not found: ${packId}`);
    }
    return project;
  }

  async getRelease(packId: string, version: string): Promise<PackRelease> {
    if (!isValidSemVer(version)) {
      throw new BadRequestException(`Invalid SemVer: ${version}`);
    }
    const release = (await this.listReleases()).find(
      (r) => r.id === packId && r.version === version,
    );
    if (!release) {
      throw new NotFoundException(`Pack not found: ${packId}@${version}`);
    }
    return release;
  }

  async createPackZip(
    packId: string,
    version?: string,
  ): Promise<{ buffer: Buffer; filename: string; sha256: string }> {
    let release: PackRelease;
    if (version) {
      release = await this.getRelease(packId, version);
      if (release.yanked) {
        throw new NotFoundException(
          `Pack version yanked: ${packId}@${version}`,
        );
      }
    } else {
      const project = await this.getProject(packId);
      release = await this.getRelease(packId, project.latest_version);
      if (release.yanked) {
        throw new NotFoundException(
          `No installable version for pack: ${packId}`,
        );
      }
    }

    const packDir = path.join(this.fixturesRoot(), release.id, release.version);
    this.debug(
      `createPackZip id=${packId} version=${release.version} dir=${packDir}`,
    );
    if (!existsSync(packDir)) {
      throw new NotFoundException(
        `Pack directory missing: ${packId}@${release.version}`,
      );
    }

    const zip = new AdmZip();
    zip.addLocalFolder(packDir, release.id);
    const buffer = zip.toBuffer();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    this.debug(`createPackZip bytes=${buffer.length} sha256=${sha256}`);

    return {
      buffer,
      filename: `${release.id}-${release.version}.zip`,
      sha256,
    };
  }
}
