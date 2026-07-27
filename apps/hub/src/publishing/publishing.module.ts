import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { PublishReviewService } from './publish-review.service';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';

@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [PublishingController],
  providers: [PublishingService, PublishReviewService],
  exports: [PublishingService],
})
export class PublishingModule {}
