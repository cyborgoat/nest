import { Controller, Get, Logger, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PacksService } from './packs.service';
import type { PackProject, PackRelease } from './pack.types';

@Controller('packs')
export class PacksController {
  private readonly logger = new Logger(PacksController.name);

  constructor(private readonly packsService: PacksService) {}

  @Get()
  listProjects(): Promise<PackProject[]> {
    return this.packsService.listProjects();
  }

  /** Latest ZIP — must be registered before `:packId/:version`. */
  @Get(':packId/download')
  async downloadLatest(
    @Param('packId') packId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.streamPackZip(packId, undefined, res);
  }

  @Get(':packId/:version/download')
  async downloadVersion(
    @Param('packId') packId: string,
    @Param('version') version: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.streamPackZip(packId, version, res);
  }

  @Get(':packId/:version')
  getRelease(
    @Param('packId') packId: string,
    @Param('version') version: string,
  ): Promise<PackRelease> {
    return this.packsService.getRelease(packId, version);
  }

  @Get(':packId')
  getProject(@Param('packId') packId: string): Promise<PackProject> {
    return this.packsService.getProject(packId);
  }

  private async streamPackZip(
    packId: string,
    version: string | undefined,
    res: Response,
  ): Promise<StreamableFile> {
    const artifact = await this.packsService.createPackZip(packId, version);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${artifact.filename}"`,
    );
    res.setHeader('Content-Length', String(artifact.byteLength));
    res.setHeader('X-Content-SHA256', artifact.sha256);

    const stream = this.packsService.openZipStream(artifact.filePath);
    const cleanup = () => {
      void this.packsService.cleanupZipFile(artifact.filePath);
    };
    stream.on('close', cleanup);
    stream.on('error', (err) => {
      this.logger.error(
        `ZIP stream error for ${artifact.filename}: ${err.message}`,
      );
      cleanup();
    });
    res.on('close', cleanup);

    return new StreamableFile(stream);
  }
}
