import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { KnowledgePackMeta } from '@nest/shared';
import { RegistryAdminGuard } from '../auth/auth.guard';
import type { UserRole } from '../auth/auth.types';
import { PacksService } from '../packs/packs.service';
import {
  PublishingService,
  type UploadedPackFile,
} from '../publishing/publishing.service';
import { AdminService, type PackPatch } from './admin.service';

function parseUploadMetadata(raw: unknown): KnowledgePackMeta | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new BadRequestException('metadata must be valid JSON');
  }
  const field = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    id: field(parsed.id),
    name: field(parsed.name),
    description: field(parsed.description),
    version: field(parsed.version),
  };
}

@Controller('api/admin')
@UseGuards(RegistryAdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly admin: AdminService,
    private readonly publishing: PublishingService,
    private readonly packsService: PacksService,
  ) {}
  @Get('users') users() {
    return this.admin.listUsers();
  }
  @Patch('users/:uuid') updateUser(
    @Req() req: Request,
    @Param('uuid') uuid: string,
    @Body() body: { role: UserRole },
  ) {
    return this.admin.updateUser(req.authUser!, uuid, body.role);
  }
  @Delete('users/:uuid') removeUser(
    @Req() req: Request,
    @Param('uuid') uuid: string,
  ) {
    return this.admin.removeUser(req.authUser!, uuid);
  }
  @Post('users/:uuid/reset-password') resetPassword(
    @Req() req: Request,
    @Param('uuid') uuid: string,
  ) {
    return this.admin.resetPassword(req.authUser!, uuid);
  }
  @Get('publish-requests') requests() {
    return this.publishing.listPending();
  }
  @Get('publish-requests/history') history(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.publishing.listHistory(
      status ?? 'all',
      Number(limit ?? 50),
      cursor,
    );
  }
  @Post('publish-requests/:id/approve') approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body?: { note?: string },
  ) {
    return this.publishing.approve(id, req.authUser!, body?.note);
  }
  @Post('publish-requests/:id/reject') reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.publishing.reject(id, req.authUser!, body.note ?? '');
  }
  @Get('publish-requests/:id/review') reviewDetail(@Param('id') id: string) {
    return this.publishing.getAdminReviewDetail(id);
  }
  @Get('publish-requests/:id/review/file') reviewFile(
    @Param('id') id: string,
    @Query('path') filePath = '',
  ) {
    return this.publishing.getAdminReviewFile(id, filePath);
  }
  @Get('publish-requests/:id/review/image') async reviewImage(
    @Param('id') id: string,
    @Query('path') filePath: string,
    @Query('side') side: string,
    @Res() res: Response,
  ) {
    const image = await this.publishing.getAdminReviewImage(
      id,
      filePath ?? '',
      side ?? '',
    );
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Length', String(image.buffer.length));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    );
    res.send(image.buffer);
  }
  @Get('publish-requests/:id/download') async download(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.publishing.getStagingZip(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
    res.send(buffer);
  }
  @Get('packs') packs() {
    return this.admin.listPacks();
  }
  @Post('packs/resync') resyncPacks(@Req() req: Request) {
    return this.admin.resyncRegistry(req.authUser!);
  }
  @Patch('packs/:id') updatePack(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: PackPatch,
  ) {
    return this.admin.updatePack(req.authUser!, id, body);
  }
  @Delete('packs/:id') removePack(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.admin.removePack(req.authUser!, id);
  }
  @Post('packs/:id/access/:userUuid') grant(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('userUuid') userUuid: string,
    @Body() body: { allowed: boolean },
  ) {
    return this.admin.setGrant(req.authUser!, id, userUuid, body.allowed);
  }
  @Post('packs/:id/maintainers/:userUuid') maintainer(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('userUuid') userUuid: string,
    @Body() body: { allowed: boolean },
  ) {
    return this.admin.setMaintainer(req.authUser!, id, userUuid, body.allowed);
  }
  @Post('packs/:id/releases/:version/yank') yank(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() body: { yanked: boolean },
  ) {
    return this.admin.setYanked(req.authUser!, id, version, body.yanked);
  }
  @Get('packs/:id/releases/:version/download')
  async downloadRelease(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('version') version: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const artifact = await this.packsService.createPackZip(
      id,
      version,
      req.authUser,
      { allowYanked: true },
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${artifact.sha256}.zip"`,
    );
    res.setHeader('Content-Length', String(artifact.byteLength));
    res.setHeader('X-Content-SHA256', artifact.sha256);

    const stream = this.packsService.openZipStream(artifact.filePath);
    const cleanup = () => {
      void this.packsService.cleanupZipFile(artifact.filePath);
    };
    stream.on('close', cleanup);
    stream.on('error', (error) => {
      this.logger.error(
        `Admin ZIP stream error for ${id}@${version}: ${error.message}`,
      );
      cleanup();
    });
    res.on('close', cleanup);

    return new StreamableFile(stream);
  }
  @Delete('packs/:id/releases/:version') removeRelease(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.admin.removeRelease(req.authUser!, id, version);
  }
  @Post('packs/inspect')
  @UseInterceptors(FileInterceptor('file'))
  inspect(@UploadedFile() file: UploadedPackFile) {
    return this.publishing.inspectUpload(file);
  }
  @Post('packs/upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: Request,
    @UploadedFile() file: UploadedPackFile,
    @Body('metadata') metadata?: string,
    @Body('commit_message') commitMessage?: string,
  ) {
    return this.publishing.submitRelease(
      req.authUser!,
      file,
      parseUploadMetadata(metadata),
      commitMessage,
    );
  }
}
