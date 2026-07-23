import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RegistryAdminGuard } from '../auth/auth.guard';
import type { UserRole } from '../auth/auth.types';
import {
  PublishingService,
  type UploadedPackFile,
} from '../publishing/publishing.service';
import { AdminService, type PackPatch } from './admin.service';

@Controller('api/admin')
@UseGuards(RegistryAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly publishing: PublishingService,
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
  @Get('publish-requests') requests() {
    return this.publishing.listPending();
  }
  @Post('publish-requests/:id/approve') approve(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.publishing.approve(id, req.authUser!);
  }
  @Post('publish-requests/:id/reject') reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.publishing.reject(id, req.authUser!, body.note ?? '');
  }
  @Get('packs') packs() {
    return this.admin.listPacks();
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
  @Post('packs/:id/releases/:version/yank') yank(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() body: { yanked: boolean },
  ) {
    return this.admin.setYanked(req.authUser!, id, version, body.yanked);
  }
  @Post('packs/upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() req: Request, @UploadedFile() file: UploadedPackFile) {
    return this.publishing.submit(req.authUser!, file, true);
  }
}
