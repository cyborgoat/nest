/**
 * Suggests the next patch version for a publish dialog's default value.
 * Republishing the exact same version the hub already has is always
 * rejected, so a bumped default nudges the user toward a valid one — they
 * can still type any version they want. Falls back to the input unchanged
 * when it isn't a recognizable `major.minor.patch` (pre-release/build
 * metadata after the patch number is preserved but not incremented).
 */
export function nextPatchVersion(version: string): string {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return version;
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}
