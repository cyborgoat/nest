import type { AdminRelease } from '@nest/shared';
import { latestInstallableVersion } from './admin.service';

function release(version: string, yanked = false): AdminRelease {
  return {
    pack_id: 'example',
    version,
    yanked,
    checksum: 'checksum',
    published_at: '2026-01-01T00:00:00.000Z',
    patch_revision: 0,
    patched_at: null,
  };
}

describe('latestInstallableVersion', () => {
  it('returns the highest non-yanked semantic version', () => {
    expect(
      latestInstallableVersion([
        release('1.9.0'),
        release('10.0.0', true),
        release('2.0.0'),
      ]),
    ).toBe('2.0.0');
  });

  it('returns null when every release is yanked', () => {
    expect(
      latestInstallableVersion([
        release('1.0.0', true),
        release('2.0.0', true),
      ]),
    ).toBeNull();
  });
});
