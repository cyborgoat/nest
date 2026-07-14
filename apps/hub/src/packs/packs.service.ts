import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { Pack } from './pack.types';

@Injectable()
export class PacksService {
  constructor(private readonly config: ConfigService) {}

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
    if (!existsSync(file)) {
      return [];
    }
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as Pack[];
  }

  async getPack(packId: string): Promise<Pack> {
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
    if (!existsSync(packDir)) {
      throw new NotFoundException(`Pack directory missing: ${packId}`);
    }

    const zip = new AdmZip();
    zip.addLocalFolder(packDir, pack.path);
    const buffer = zip.toBuffer();

    return { buffer, filename: `${packId}.zip` };
  }
}
