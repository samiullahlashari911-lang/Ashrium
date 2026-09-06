import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.TENANT_KEY_ENCRYPTION_KEY?.trim();
  if (!encodedKey) {
    throw new Error('TENANT_KEY_ENCRYPTION_KEY is not configured.');
  }

  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('TENANT_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  return key;
}

export function encryptTenantSecret(secret: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    initializationVector.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptTenantSecret(ciphertext: string): string | null {
  const [version, initializationVector, authTag, encryptedSecret, ...extraParts] =
    ciphertext.split('.');
  if (
    version !== 'v1'
    || !initializationVector
    || !authTag
    || !encryptedSecret
    || extraParts.length > 0
  ) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(initializationVector, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedSecret, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
