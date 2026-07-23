import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublishingModule } from '../publishing/publishing.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, PublishingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
