import { Global, Module } from '@nestjs/common';
import { HubRuntimeConfig } from './hub.config';

@Global()
@Module({ providers: [HubRuntimeConfig], exports: [HubRuntimeConfig] })
export class HubConfigModule {}
