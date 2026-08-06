import { isValidPackId, slugifyPackId } from './pack-id';

describe('isValidPackId', () => {
  it('accepts Chinese and mixed lowercase IDs', () => {
    expect(isValidPackId('我的知识包')).toBe(true);
    expect(isValidPackId('我的-pack-2')).toBe(true);
  });

  it('rejects uppercase letters and unsafe separators', () => {
    expect(isValidPackId('My-pack')).toBe(false);
    expect(isValidPackId('我的_pack')).toBe(false);
    expect(isValidPackId('我的/pack')).toBe(false);
  });

  it('retains Chinese characters while normalizing separators and case', () => {
    expect(slugifyPackId('我的知识包')).toBe('我的知识包');
    expect(slugifyPackId('我的 Pack 笔记')).toBe('我的-pack-笔记');
  });
});
