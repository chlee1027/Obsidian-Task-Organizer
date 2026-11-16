// Encryption at rest for users' Gemini API keys (AES-256-GCM, Node built-in crypto).
//
// Environment variables:
//   KEY_ENCRYPTION_SECRET  required for saving keys. Any string; the 32-byte AES key is its
//                          SHA-256 digest, so the value is used as typed (it is not base64-decoded).
//                          Generate one with:
//                          node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Stored format: v1:<iv base64>:<auth tag base64>:<ciphertext base64>, a fresh 12-byte IV each time.
// Values without the v1: prefix are keys saved before encryption existed (plaintext). They are
// still read as-is and re-saved encrypted the next time they are read while the secret is set.
//
// When the secret is missing: writes fail with an error; legacy plaintext keys keep working;
// encrypted keys cannot be read and the request fails with an error.
// Neither the secret nor a plaintext key is ever logged or put in an error message.

const crypto = require('crypto');
const { setJson } = require('./store');

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const MISSING_SECRET_MESSAGE =
  '서버 설정 오류: KEY_ENCRYPTION_SECRET 환경 변수가 없어 API 키를 암호화하거나 풀 수 없습니다. 관리자에게 알려주세요.';
const UNREADABLE_MESSAGE =
  '저장된 API 키를 풀 수 없습니다. 설정에서 API 키를 다시 입력하고 저장해주세요.';

let cachedFor = null;
let cachedKey = null;

// Returns the 32-byte key, or null if the secret is not configured
function encryptionKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET || '';
  if (!secret) return null;
  if (secret !== cachedFor) {
    cachedKey = crypto.createHash('sha256').update(secret, 'utf8').digest();
    cachedFor = secret;
  }
  return cachedKey;
}

function hasEncryptionSecret() {
  return encryptionKey() !== null;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(plaintext) {
  const key = encryptionKey();
  if (!key) throw new Error(MISSING_SECRET_MESSAGE);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// Returns the plaintext key. Legacy values (no v1: prefix) are returned unchanged.
function decryptSecret(stored) {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored;
  const key = encryptionKey();
  if (!key) throw new Error(MISSING_SECRET_MESSAGE);
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error(UNREADABLE_MESSAGE);
  const [iv, tag, ciphertext] = parts.map(p => Buffer.from(p, 'base64'));
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error(UNREADABLE_MESSAGE);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (e) {
    // Wrong secret or a tampered value; do not pass the crypto error text along
    throw new Error(UNREADABLE_MESSAGE);
  }
}

// Value to store: encrypts plaintext, keeps an already-encrypted value, keeps empty as empty
function sealForStorage(value) {
  if (!value) return '';
  return isEncrypted(value) ? value : encryptSecret(value);
}

// Lazy migration: if the config still holds a plaintext key and the secret is set,
// re-save it encrypted. A failed re-save does not fail the request; it is retried next read.
async function migrateLegacyKey(storeKey, config) {
  if (!config || !config.geminiApiKey || isEncrypted(config.geminiApiKey) || !hasEncryptionSecret()) {
    return config;
  }
  const migrated = { ...config, geminiApiKey: encryptSecret(config.geminiApiKey) };
  try {
    await setJson(storeKey, migrated);
    return migrated;
  } catch (e) {
    console.error('API 키 암호화 재저장 실패 (다음 읽기에서 다시 시도):', e.message);
    return config;
  }
}

module.exports = {
  hasEncryptionSecret,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  sealForStorage,
  migrateLegacyKey
};
