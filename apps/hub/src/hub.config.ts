import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import * as path from 'path';

type HubCorsConfig = { mode: 'all' } | { mode: 'origins'; origins: string[] };

type HubConfig = {
  host: string;
  port: number;
  /** Absolute path to the pack registry root on disk. */
  registryPath: string;
  debug: boolean;
  cors: HubCorsConfig;
  downloadTimeoutMs: number;
  databasePath: string;
  stagingPath: string;
  maxPackUploadBytes: number;
  jwtSecret: string;
  minPasswordLength: number;
  superuserId?: string;
  superuserPassword?: string;
  superuserName: string;
  defaultResetPassword?: string;
};

function optionalString(
  config: ConfigService,
  key: string,
): string | undefined {
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
  return ['1', 'true', 'yes', 'on'].includes(
    (value ?? '').trim().toLowerCase(),
  );
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

function resolveRegistryPath(config: ConfigService): string {
  return path.resolve(process.cwd(), requireString(config, 'REGISTRY_PATH'));
}

function positiveInteger(config: ConfigService, key: string): number {
  const raw = requireString(config, key);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got: ${raw}`);
  }
  return value;
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
  const downloadTimeoutMs = positiveInteger(config, 'DOWNLOAD_TIMEOUT_MS');
  const jwtSecret = requireString(config, 'JWT_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }

  const minPasswordLength = positiveInteger(config, 'MIN_PASSWORD_LENGTH');
  const defaultResetPassword = optionalString(config, 'DEFAULT_RESET_PASSWORD');
  if (defaultResetPassword && defaultResetPassword.length < minPasswordLength) {
    throw new Error(
      `DEFAULT_RESET_PASSWORD must contain at least ${minPasswordLength} characters`,
    );
  }

  return {
    host,
    port,
    registryPath,
    debug: parseTruthy(requireString(config, 'DEBUG_MODE')),
    cors: parseCors(corsRaw),
    downloadTimeoutMs,
    databasePath: path.resolve(
      process.cwd(),
      requireString(config, 'DATABASE_PATH'),
    ),
    stagingPath: path.resolve(
      process.cwd(),
      requireString(config, 'STAGING_PATH'),
    ),
    maxPackUploadBytes: positiveInteger(config, 'MAX_PACK_UPLOAD_BYTES'),
    jwtSecret,
    minPasswordLength,
    superuserId: optionalString(config, 'SUPERUSER_ID')?.toLowerCase(),
    superuserPassword: optionalString(config, 'SUPERUSER_PASSWORD'),
    superuserName: optionalString(config, 'SUPERUSER_NAME') ?? 'Administrator',
    defaultResetPassword,
  };
}

@Injectable()
export class HubRuntimeConfig {
  readonly value: HubConfig;

  constructor(config: ConfigService) {
    this.value = loadHubConfig(config);
  }
}
