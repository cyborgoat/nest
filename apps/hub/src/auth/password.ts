import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';

const FORMAT = 'scrypt:v1';
const SALT_BYTES = 16;
const KEY_BYTES = 32;

const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    deriveKey(password, salt, KEY_BYTES, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt);
  return `${FORMAT}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  const [algorithm, version, encodedSalt, encodedKey, ...extra] =
    storedHash.split(':');
  if (
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    !encodedSalt ||
    !encodedKey ||
    extra.length
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expectedKey = Buffer.from(encodedKey, 'base64url');
    if (salt.length !== SALT_BYTES || expectedKey.length !== KEY_BYTES)
      return false;
    const actualKey = await scrypt(password, salt);
    return timingSafeEqual(expectedKey, actualKey);
  } catch {
    return false;
  }
}
