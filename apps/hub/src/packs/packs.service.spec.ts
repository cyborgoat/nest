import { NotFoundException } from '@nestjs/common';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AuthUser } from '../auth/auth.types';
import type { DatabaseService } from '../database/database.service';
import type { HubRuntimeConfig } from '../hub.config';
import { PacksService } from './packs.service';

const admin: AuthUser = {
  uuid: 'admin-uuid',
  id: 'admin',
  name: 'Admin',
  role: 'admin',
  managed: false,
};

describe('PacksService administrative ZIP retrieval', () => {
  it('keeps yanked releases blocked by default but allows an explicit admin retrieval', async () => {
    const registryPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'nest-packs-service-'),
    );
    const versionPath = path.join(registryPath, 'example', '2.0.0');
    await fs.mkdir(versionPath, { recursive: true });
    await fs.writeFile(path.join(versionPath, 'README.md'), '# Example');

    const config = {
      value: { registryPath, debug: false },
    } as HubRuntimeConfig;
    const service = new PacksService(config, {} as DatabaseService);
    jest.spyOn(service, 'getRelease').mockResolvedValue({
      id: 'example',
      name: 'Example',
      description: '',
      version: '2.0.0',
      path: 'example',
      yanked: true,
    });

    try {
      await expect(
        service.createPackZip('example', '2.0.0', admin),
      ).rejects.toBeInstanceOf(NotFoundException);

      const artifact = await service.createPackZip('example', '2.0.0', admin, {
        allowYanked: true,
      });
      expect(artifact.filename).toBe('example-2.0.0.zip');
      expect(artifact.byteLength).toBeGreaterThan(0);
      expect(existsSync(artifact.filePath)).toBe(true);

      await service.cleanupZipFile(artifact.filePath);
      expect(existsSync(artifact.filePath)).toBe(false);
    } finally {
      await fs.rm(registryPath, { recursive: true, force: true });
    }
  });
});
