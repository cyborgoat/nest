import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { accessSync, constants, existsSync } from 'fs';
import { loadHubConfig } from './hub.config';

@Controller()
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: registry path exists and is readable. */
  @Get('ready')
  ready() {
    const { registryPath } = loadHubConfig(this.config);
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
