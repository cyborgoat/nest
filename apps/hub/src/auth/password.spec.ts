import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^scrypt:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    await expect(
      verifyPassword(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('uses a unique salt for each hash', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');

    expect(first).not.toBe(second);
  });

  it('rejects unsupported and malformed hashes', async () => {
    await expect(
      verifyPassword('$argon2id$legacy-hash', 'password'),
    ).resolves.toBe(false);
    await expect(verifyPassword('scrypt:v1:bad:bad', 'password')).resolves.toBe(
      false,
    );
  });
});
