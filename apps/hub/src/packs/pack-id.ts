const PACK_ID_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

/** Pack IDs retain uncased scripts such as Chinese while cased letters stay
 * lowercase. Hyphens are the only separator accepted in registry paths. */
export function isValidPackId(value: string): boolean {
  return PACK_ID_RE.test(value) && value === value.toLowerCase();
}

export function slugifyPackId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug || 'knowledge-pack';
}
