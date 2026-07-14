import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { PacksService } from './packs.service';
import type { Pack } from './pack.types';

@Controller('packs')
export class PacksController {
  constructor(private readonly packsService: PacksService) {}

  @Get()
  listPacks(): Promise<Pack[]> {
    return this.packsService.listPacks();
  }

  @Get(':packId')
  getPack(@Param('packId') packId: string): Promise<Pack> {
    return this.packsService.getPack(packId);
  }

  @Get(':packId/download')
  async downloadPack(@Param('packId') packId: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.packsService.createPackZip(packId);
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
