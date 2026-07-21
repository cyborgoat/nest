import { ConfigService } from '@nestjs/config';
import * as path from 'path';

export type HubCorsConfig =
  | { mode: 'all' }
  | { mode: 'origins'; origins: string[] };

export type HubConfig = {
  host: string;
  port: number;
  /** Absolute path to the pack registry root on disk. */
  registryPath: string;
  debug: boolean;
  cors: HubCorsConfig;
  downloadTimeoutMs: number;
};

function optionalString(config: ConfigService, key: string): string | undefined {
  const value = config.get<string>(key);
  if (value == null || String(value).trim() === '') {
    return undefined;
  }
  return String(value).trim();
}

function requireString(config: ConfigService, key: string): string {
  const value = optionalString(config, key);
  if (value == null) {
    throw new Error(
      `${key} is not set. Copy apps/hub/.env.example to apps/hub/.env and configure it.`,
    );
  }
  return value;
}

function parseTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function parseCors(raw: string): HubCorsConfig {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') {
    return { mode: 'all' };
  }
  const origins = trimmed
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    return { mode: 'all' };
  }
  return { mode: 'origins', origins };
}

/** DEBUG_MODE preferred; NEST_DEBUG kept as deprecated alias. */
export function isDebugEnabled(config: ConfigService): boolean {
  const debugMode = config.get<string>('DEBUG_MODE');
  if (debugMode != null && String(debugMode).trim() !== '') {
    return parseTruthy(debugMode);
  }
  return parseTruthy(config.get<string>('NEST_DEBUG'));
}

/**
 * REGISTRY_PATH preferred.
 * VAULT_PATH and FIXTURES_PATH kept as deprecated aliases.
 */
function resolveRegistryPath(config: ConfigService): string {
  const configured =
    optionalString(config, 'REGISTRY_PATH') ??
    optionalString(config, 'VAULT_PATH') ??
    optionalString(config, 'FIXTURES_PATH');
  if (configured == null) {
    throw new Error(
      'REGISTRY_PATH is not set. Copy apps/hub/.env.example to apps/hub/.env and configure it.',
    );
  }
  return path.resolve(process.cwd(), configured);
}

export function loadHubConfig(config: ConfigService): HubConfig {
  const host = requireString(config, 'HOST');
  const portRaw = requireString(config, 'PORT');
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port number, got: ${portRaw}`);
  }

  const registryPath = resolveRegistryPath(config);

  const corsRaw = config.get<string>('CORS_ORIGIN') ?? '*';
  const timeoutRaw = (config.get<string>('DOWNLOAD_TIMEOUT_MS') ?? '120000').trim();
  const downloadTimeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(downloadTimeoutMs) || downloadTimeoutMs <= 0) {
    throw new Error(
      `DOWNLOAD_TIMEOUT_MS must be a positive number of milliseconds, got: ${timeoutRaw}`,
    );
  }

  return {
    host,
    port,
    registryPath,
    debug: isDebugEnabled(config),
    cors: parseCors(corsRaw),
    downloadTimeoutMs,
  };
}
