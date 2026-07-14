import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { Pack } from './pack.types';

function nestDebugEnabled(config: ConfigService): boolean {
  const v = (config.get<string>('NEST_DEBUG') ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

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

  private async readPackJson(packDir: string): Promise<Pack | null> {
    const metaPath = path.join(packDir, 'pack.json');
    if (!existsSync(metaPath)) {
      return null;
    }
    const raw = await fs.readFile(metaPath, 'utf8');
    const pack = JSON.parse(raw) as Pack;
    if (
      !pack.id?.trim() ||
      !pack.name?.trim() ||
      !pack.version?.trim() ||
      !pack.path?.trim()
    ) {
      throw new Error(
        `Invalid pack.json in ${packDir}: id, name, version, and path are required`,
      );
    }
    return {
      id: pack.id.trim(),
      name: pack.name.trim(),
      description: (pack.description ?? '').trim(),
      version: pack.version.trim(),
      path: pack.path.trim(),
    };
  }

  async listPacks(): Promise<Pack[]> {
    const root = this.fixturesRoot();
    this.debug(`listPacks root=${root}`);
    if (!existsSync(root)) {
      this.debug('fixtures root missing — returning []');
      return [];
    }

    const entries = await fs.readdir(root, { withFileTypes: true });
    const packs: Pack[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const packDir = path.join(root, entry.name);
      try {
        const pack = await this.readPackJson(packDir);
        if (pack) {
          packs.push(pack);
        }
      } catch (e) {
        this.logger.warn(
          `Skipping ${entry.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    this.debug(`listPacks count=${packs.length}`);
    return packs;
  }

  async getPack(packId: string): Promise<Pack> {
    this.debug(`getPack id=${packId}`);
    const pack = (await this.listPacks()).find((p) => p.id === packId);
    if (!pack) {
      throw new NotFoundException(`Pack not found: ${packId}`);
    }
    return pack;
  }

  async createPackZip(
    packId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const pack = await this.getPack(packId);
    const packDir = path.join(this.fixturesRoot(), pack.path);
    this.debug(`createPackZip id=${packId} dir=${packDir}`);
    if (!existsSync(packDir)) {
      throw new NotFoundException(`Pack directory missing: ${packId}`);
    }
    if (!existsSync(path.join(packDir, 'pack.json'))) {
      throw new NotFoundException(
        `pack.json missing for pack: ${packId}. Every knowledge pack requires pack.json.`,
      );
    }

    const zip = new AdmZip();
    zip.addLocalFolder(packDir, pack.path);
    const buffer = zip.toBuffer();
    this.debug(`createPackZip bytes=${buffer.length}`);

    return { buffer, filename: `${packId}.zip` };
  }
}
