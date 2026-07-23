import {
  Controller,
  Get,
  Logger,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OptionalAuthGuard } from '../auth/auth.guard';
import { PacksService } from './packs.service';
import type { PackProject, PackRelease } from './pack.types';

@Controller('packs')
@UseGuards(OptionalAuthGuard)
export class PacksController {
  private readonly logger = new Logger(PacksController.name);

  constructor(private readonly packsService: PacksService) {}

  @Get()
  listProjects(@Req() req: Request): Promise<PackProject[]> {
    return this.packsService.listProjects(req.authUser);
  }

  /** Latest ZIP — must be registered before `:packId/:version`. */
  @Get(':packId/download')
  async downloadLatest(
    @Param('packId') packId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.streamPackZip(packId, undefined, res, req);
  }

  @Get(':packId/:version/download')
  async downloadVersion(
    @Param('packId') packId: string,
    @Param('version') version: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.streamPackZip(packId, version, res, req);
  }

  @Get(':packId/:version')
  getRelease(
    @Param('packId') packId: string,
    @Param('version') version: string,
    @Req() req: Request,
  ): Promise<PackRelease> {
    return this.packsService.getRelease(packId, version, req.authUser);
  }

  @Get(':packId')
  getProject(
    @Param('packId') packId: string,
    @Req() req: Request,
  ): Promise<PackProject> {
    return this.packsService.getProject(packId, req.authUser);
  }

  private async streamPackZip(
    packId: string,
    version: string | undefined,
    res: Response,
    req: Request,
  ): Promise<StreamableFile> {
    const artifact = await this.packsService.createPackZip(
      packId,
      version,
      req.authUser,
    );
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
