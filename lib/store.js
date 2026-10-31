// Key-value storage backed by Upstash Redis (REST API, no SDK needed).
// Vercel's Upstash integration injects KV_REST_API_URL / KV_REST_API_TOKEN;
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are accepted too.
// Outside Vercel (local development) an in-memory map is used when Redis is not configured.

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const memory = new Map();

async function redis(command) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    if (process.env.VERCEL) {
      throw new Error('저장소(Upstash Redis)가 연결되지 않았습니다. Vercel 프로젝트의 Storage 탭에서 연결해주세요.');
    }
    return memoryCommand(command);
  }
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`저장소 오류: ${data.error || res.status}`);
  }
  return data.result;
}

// Tiny subset of Redis semantics for local development
function memoryCommand([cmd, key, ...args]) {
  const now = Date.now();
  const entry = memory.get(key);
  if (entry && entry.expiresAt && entry.expiresAt <= now) memory.delete(key);
  switch (cmd) {
    case 'GET':
      return memory.has(key) ? memory.get(key).value : null;
    case 'SET':
      if (args[1] === 'NX' && memory.has(key)) return null;
      memory.set(key, { value: args[0], expiresAt: null });
      return 'OK';
    case 'DEL':
      return memory.delete(key) ? 1 : 0;
    case 'INCR': {
      const cur = memory.get(key);
      const value = String(Number(cur ? cur.value : 0) + 1);
      memory.set(key, { value, expiresAt: cur ? cur.expiresAt : null });
      return Number(value);
    }
    case 'EXPIRE': {
      const cur = memory.get(key);
      if (!cur) return 0;
      cur.expiresAt = now + Number(args[0]) * 1000;
      return 1;
    }
    default:
      throw new Error(`unsupported command ${cmd}`);
  }
}

async function getJson(key) {
  const raw = await redis(['GET', key]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function setJson(key, value) {
  await redis(['SET', key, JSON.stringify(value)]);
}

module.exports = { redis, getJson, setJson };
