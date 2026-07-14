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

  private packsFile(): string {
    return path.join(this.fixturesRoot(), 'packs.json');
  }

  async listPacks(): Promise<Pack[]> {
    const file = this.packsFile();
    this.debug(`listPacks file=${file}`);
    if (!existsSync(file)) {
      this.debug('packs.json missing — returning []');
      return [];
    }
    const raw = await fs.readFile(file, 'utf8');
    const packs = JSON.parse(raw) as Pack[];
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

    const zip = new AdmZip();
    zip.addLocalFolder(packDir, pack.path);
    const buffer = zip.toBuffer();
    this.debug(`createPackZip bytes=${buffer.length}`);

    return { buffer, filename: `${packId}.zip` };
  }
}
