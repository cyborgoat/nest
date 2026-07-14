import { compareSemVer, isValidSemVer, sortSemVerDesc } from './semver';

describe('semver', () => {
  it('validates versions', () => {
    expect(isValidSemVer('1.0.0')).toBe(true);
    expect(isValidSemVer('1.2.3-beta')).toBe(true);
    expect(isValidSemVer('v1.0.0')).toBe(false);
    expect(isValidSemVer('1.0')).toBe(false);
  });

  it('orders SemVer descending', () => {
    expect(sortSemVerDesc(['1.0.0', '1.1.0', '1.0.1'])).toEqual([
      '1.1.0',
      '1.0.1',
      '1.0.0',
    ]);
    expect(compareSemVer('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });
});
