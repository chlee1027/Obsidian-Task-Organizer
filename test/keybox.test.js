// Tests for lib/keybox.js (node:test, no dependencies). Run: npm test
// Uses the in-memory store: Redis variables are cleared before the modules load.

for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL_ENV']) {
  delete process.env[name];
}

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  isEncrypted, encryptSecret, decryptSecret, sealForStorage, migrateLegacyKey
} = require('../lib/keybox');
const { getJson, setJson } = require('../lib/store');

const SECRET = crypto.randomBytes(32).toString('base64');
const PLAIN = 'AIzaSy-test-key-0123456789';

function withSecret(value, fn) {
  const before = process.env.KEY_ENCRYPTION_SECRET;
  if (value === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
  else process.env.KEY_ENCRYPTION_SECRET = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = before;
  }
}

test('암호화 뒤 복호화하면 원래 키가 나온다', () => withSecret(SECRET, () => {
  const sealed = encryptSecret(PLAIN);
  assert.ok(isEncrypted(sealed));
  assert.equal(sealed.split(':').length, 4);
  assert.ok(!sealed.includes(PLAIN));
  assert.equal(decryptSecret(sealed), PLAIN);
}));

test('같은 키를 두 번 암호화하면 IV 가 달라 결과가 다르다', () => withSecret(SECRET, () => {
  const a = encryptSecret(PLAIN);
  const b = encryptSecret(PLAIN);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a.split(':')[1], 'base64').length, 12);
}));

test('암호문·태그·IV 를 바꾸면 복호화가 실패한다', () => withSecret(SECRET, () => {
  const [, iv, tag, ct] = encryptSecret(PLAIN).split(':');
  const flip = b64 => {
    const buf = Buffer.from(b64, 'base64');
    buf[0] ^= 1;
    return buf.toString('base64');
  };
  for (const bad of [
    `v1:${iv}:${tag}:${flip(ct)}`,
    `v1:${iv}:${flip(tag)}:${ct}`,
    `v1:${flip(iv)}:${tag}:${ct}`,
    `v1:${iv}:${tag}`
  ]) {
    assert.throws(() => decryptSecret(bad), /풀 수 없습니다/);
  }
}));

test('다른 비밀값으로는 풀리지 않는다', () => {
  const sealed = withSecret(SECRET, () => encryptSecret(PLAIN));
  withSecret('another-secret', () => {
    assert.throws(() => decryptSecret(sealed), /풀 수 없습니다/);
  });
});

test('v1: 이 없는 옛 평문 키는 그대로 읽힌다 (비밀값이 없어도)', () => {
  withSecret(SECRET, () => assert.equal(decryptSecret(PLAIN), PLAIN));
  withSecret(undefined, () => assert.equal(decryptSecret(PLAIN), PLAIN));
  assert.equal(decryptSecret(''), '');
});

test('비밀값이 없으면 쓰기와 암호문 읽기가 실패한다', () => {
  const sealed = withSecret(SECRET, () => encryptSecret(PLAIN));
  withSecret(undefined, () => {
    assert.throws(() => encryptSecret(PLAIN), /KEY_ENCRYPTION_SECRET/);
    assert.throws(() => sealForStorage(PLAIN), /KEY_ENCRYPTION_SECRET/);
    assert.equal(sealForStorage(sealed), sealed);
    assert.equal(sealForStorage(''), '');
    assert.throws(() => decryptSecret(sealed), /KEY_ENCRYPTION_SECRET/);
  });
});

test('옛 평문 키는 읽을 때 암호화되어 다시 저장된다', async () => {
  const storeKey = 'aoto:config:legacy-user';
  await setJson(storeKey, { geminiApiKey: PLAIN, vaultName: 'v' });

  // Without the secret nothing changes
  delete process.env.KEY_ENCRYPTION_SECRET;
  const untouched = await migrateLegacyKey(storeKey, await getJson(storeKey));
  assert.equal(untouched.geminiApiKey, PLAIN);
  assert.equal((await getJson(storeKey)).geminiApiKey, PLAIN);

  process.env.KEY_ENCRYPTION_SECRET = SECRET;
  try {
    const migrated = await migrateLegacyKey(storeKey, await getJson(storeKey));
    const saved = await getJson(storeKey);
    assert.ok(isEncrypted(saved.geminiApiKey));
    assert.equal(saved.vaultName, 'v');
    assert.equal(migrated.geminiApiKey, saved.geminiApiKey);
    assert.equal(decryptSecret(saved.geminiApiKey), PLAIN);

    // Already encrypted: no further change
    const again = await migrateLegacyKey(storeKey, saved);
    assert.equal(again.geminiApiKey, saved.geminiApiKey);
  } finally {
    delete process.env.KEY_ENCRYPTION_SECRET;
  }
});
