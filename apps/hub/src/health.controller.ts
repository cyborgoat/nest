import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { accessSync, constants, existsSync } from 'fs';
import { HubRuntimeConfig } from './hub.config';

@Controller()
export class HealthController {
  constructor(private readonly config: HubRuntimeConfig) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: registry path exists and is readable. */
  @Get('ready')
  ready() {
    const { registryPath } = this.config.value;
    if (!existsSync(registryPath)) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'registry_missing',
        registryPath,
      });
    }
    try {
      accessSync(registryPath, constants.R_OK);
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'registry_unreadable',
        registryPath,
      });
    }
    return { status: 'ready', registryPath };
  }
}
