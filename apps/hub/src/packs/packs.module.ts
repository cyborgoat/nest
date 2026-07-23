import { Module } from '@nestjs/common';
import { PacksController } from './packs.controller';
import { PacksService } from './packs.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PacksController],
  providers: [PacksService],
})
export class PacksModule {}
