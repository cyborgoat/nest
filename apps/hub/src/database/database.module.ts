import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [DatabaseService, AuditService],
  exports: [DatabaseService, AuditService],
})
export class DatabaseModule {}
