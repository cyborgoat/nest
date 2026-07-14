/**
 * Minimal SemVer helpers (major.minor.patch, optional prerelease ignored for ordering).
 */

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export function isValidSemVer(version: string): boolean {
  return SEMVER_RE.test(version.trim());
}

export function compareSemVer(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parse(version: string): [number, number, number] | null {
  const m = version.trim().match(SEMVER_RE);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function sortSemVerDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareSemVer(b, a));
}
