import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard, OptionalAuthGuard, RegistryAdminGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OptionalAuthGuard, RegistryAdminGuard],
  exports: [AuthService, AuthGuard, OptionalAuthGuard, RegistryAdminGuard],
})
export class AuthModule {}
