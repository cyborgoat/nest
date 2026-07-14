import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PacksService } from './packs.service';
import type { PackProject, PackRelease } from './pack.types';

@Controller('packs')
export class PacksController {
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
    const { buffer, filename, sha256 } =
      await this.packsService.createPackZip(packId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-SHA256', sha256);
    return new StreamableFile(buffer);
  }

  @Get(':packId/:version/download')
  async downloadVersion(
    @Param('packId') packId: string,
    @Param('version') version: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename, sha256 } = await this.packsService.createPackZip(
      packId,
      version,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-SHA256', sha256);
    return new StreamableFile(buffer);
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
}
