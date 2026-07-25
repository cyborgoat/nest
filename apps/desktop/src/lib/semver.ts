export function compareSemVer(a: string, b: string): number {
  const parse = (version: string): [number, number, number] | null => {
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const parsedA = parse(a);
  const parsedB = parse(b);
  if (!parsedA || !parsedB) {
    return a.localeCompare(b);
  }

  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] !== parsedB[i]) {
      return parsedA[i] - parsedB[i];
    }
  }

  return 0;
}

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
