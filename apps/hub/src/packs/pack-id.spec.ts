import { isValidPackId, slugifyPackId } from './pack-id';

describe('isValidPackId', () => {
  it('accepts cased and uncased IDs', () => {
    expect(isValidPackId('我的知识包')).toBe(true);
    expect(isValidPackId('我的-pack-2')).toBe(true);
    expect(isValidPackId('My-Pack')).toBe(true);
  });

  it('rejects unsafe separators', () => {
    expect(isValidPackId('我的_pack')).toBe(false);
    expect(isValidPackId('我的/pack')).toBe(false);
  });

  it('retains characters and casing while normalizing separators', () => {
    expect(slugifyPackId('我的知识包')).toBe('我的知识包');
    expect(slugifyPackId('我的 Pack 笔记')).toBe('我的-Pack-笔记');
    expect(slugifyPackId('My Knowledge Pack')).toBe('My-Knowledge-Pack');
  });
});
