import { ConfigService } from '@nestjs/config';
import { loadHubConfig } from './hub.config';

function config(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    HOST: '127.0.0.1',
    PORT: '8787',
    REGISTRY_PATH: './registry',
    DEBUG_MODE: 'false',
    CORS_ORIGIN: 'https://one.example, https://two.example',
    DOWNLOAD_TIMEOUT_MS: '120000',
    DATABASE_PATH: './data/hub.sqlite3',
    STAGING_PATH: './data/staging',
    MAX_PACK_UPLOAD_BYTES: '104857600',
    JWT_SECRET: 'a-unique-secret-that-is-at-least-32-characters',
    MIN_PASSWORD_LENGTH: '8',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('loadHubConfig', () => {
  it('normalizes the complete runtime contract once', () => {
    const result = loadHubConfig(
      config({
        DEBUG_MODE: 'yes',
        SUPERUSER_ID: ' Root ',
        SUPERUSER_NAME: 'Primary Admin',
      }),
    );

    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(8787);
    expect(result.debug).toBe(true);
    expect(result.cors).toEqual({
      mode: 'origins',
      origins: ['https://one.example', 'https://two.example'],
    });
    expect(result.registryPath).toMatch(/registry$/);
    expect(result.superuserId).toBe('root');
    expect(result.superuserName).toBe('Primary Admin');
  });

  it('rejects missing required values instead of using legacy aliases', () => {
    expect(() =>
      loadHubConfig(
        config({ REGISTRY_PATH: '', VAULT_PATH: './legacy-registry' }),
      ),
    ).toThrow('REGISTRY_PATH is not set');
  });

  it.each([
    ['PORT', '0', 'PORT must be a valid TCP port number'],
    ['MAX_PACK_UPLOAD_BYTES', '-1', 'must be a positive integer'],
    ['JWT_SECRET', 'too-short', 'at least 32 characters'],
  ])('rejects invalid %s', (key, value, message) => {
    expect(() => loadHubConfig(config({ [key]: value }))).toThrow(message);
  });
});
