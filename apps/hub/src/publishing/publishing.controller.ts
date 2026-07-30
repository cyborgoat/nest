import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PublishingService, type UploadedPackFile } from './publishing.service';

@Controller('api/publish-requests')
@UseGuards(AuthGuard)
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  /** Legacy compatibility: the generic endpoint is release-only. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  submitLegacy(@Req() req: Request, @UploadedFile() file: UploadedPackFile) {
    return this.publishing.submitRelease(req.authUser!, file);
  }

  @Post('releases')
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  submitRelease(@Req() req: Request, @UploadedFile() file: UploadedPackFile) {
    return this.publishing.submitRelease(req.authUser!, file);
  }

  @Post('live-patches/:packId/:version')
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  submitLivePatch(
    @Req() req: Request,
    @Param('packId') packId: string,
    @Param('version') version: string,
    @UploadedFile() file: UploadedPackFile,
  ) {
    return this.publishing.submitLivePatch(
      req.authUser!,
      file,
      packId,
      version,
    );
  }
  @Get('mine') mine(@Req() req: Request) {
    return this.publishing.listMine(req.authUser!);
  }
  @Get('pack/:packId/pending') pending(
    @Req() req: Request,
    @Param('packId') packId: string,
  ) {
    return {
      pending: this.publishing.getPendingForPack(packId, req.authUser!),
    };
  }
  @Get(':id') get(@Req() req: Request, @Param('id') id: string) {
    return this.publishing.getRequest(id, req.authUser!);
  }
}
