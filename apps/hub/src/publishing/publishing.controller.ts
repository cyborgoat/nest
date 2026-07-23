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
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  submit(@Req() req: Request, @UploadedFile() file: UploadedPackFile) {
    return this.publishing.submit(req.authUser!, file);
  }
  @Get('mine') mine(@Req() req: Request) {
    return this.publishing.listMine(req.authUser!);
  }
  @Get(':id') get(@Req() req: Request, @Param('id') id: string) {
    return this.publishing.getRequest(id, req.authUser!);
  }
}
