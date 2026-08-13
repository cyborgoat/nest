const PACK_ID_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

/** Pack IDs preserve letter casing. Hyphens are the only separator accepted
 * in registry paths. */
export function isValidPackId(value: string): boolean {
  return PACK_ID_RE.test(value);
}

export function slugifyPackId(value: string): string {
  const slug = value
    .trim()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug || 'knowledge-pack';
}
