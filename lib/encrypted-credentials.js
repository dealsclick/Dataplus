const crypto = require('node:crypto');

function encryptionKey(env = process.env) {
  const value = String(env.DATAPLUS_CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) return decoded;
  throw new Error('DATAPLUS_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hex value.');
}

function seal(value, env = process.env) {
  const key = encryptionKey(env);
  if (!key) throw new Error('Set DATAPLUS_CREDENTIALS_ENCRYPTION_KEY before saving marketplace credentials.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function unseal(envelope, env = process.env) {
  if (!envelope) return null;
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported credential encryption format.');
  const key = encryptionKey(env);
  if (!key) throw new Error('DATAPLUS_CREDENTIALS_ENCRYPTION_KEY is required to read saved marketplace credentials.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8'));
  } catch {
    throw new Error('Saved marketplace credentials could not be decrypted with the configured key.');
  }
}

module.exports = { encryptionKey, seal, unseal };
