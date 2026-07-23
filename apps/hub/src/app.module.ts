import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PacksModule } from './packs/packs.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PublishingModule } from './publishing/publishing.module';
import { AdminModule } from './admin/admin.module';
import { MessagesModule } from './messages/messages.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { HubConfigModule } from './hub-config.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: path.join(process.cwd(), 'public', 'admin'),
      serveRoot: '/admin',
      exclude: ['/api/{*path}', '/packs/{*path}', '/health', '/ready'],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    HubConfigModule,
    DatabaseModule,
    AuthModule,
    MessagesModule,
    PublishingModule,
    AdminModule,
    PacksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
