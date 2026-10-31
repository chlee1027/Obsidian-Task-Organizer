// Shared helpers for the /api functions: JSON I/O, user accounts and session cookies.
//
// Environment variables:
//   SESSION_SECRET  optional; cookie signing key. If unset, a random key is generated once
//                   and kept in Redis.

const crypto = require('crypto');
const { promisify } = require('util');
const { redis, getJson } = require('./store');

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'aoto_session';
const SESSION_DAYS = 365;
const MAX_AUTH_FAILURES = 10;           // failed logins per IP
const AUTH_FAILURE_WINDOW_SEC = 15 * 60;
const MAX_SIGNUPS = 5;                  // new accounts per IP
const SIGNUP_WINDOW_SEC = 60 * 60;
const USERNAME_RE = /^[a-z0-9_-]{3,20}$/;
const MIN_PASSWORD_LENGTH = 8;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Vercel pre-parses JSON bodies into req.body; fall back to reading the stream.
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// Only accept JSON POSTs: a cross-site HTML form cannot send application/json,
// which (with the SameSite cookie) blocks CSRF.
function isJsonRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function normalizeUsername(u) {
  return typeof u === 'string' ? u.trim().toLowerCase() : '';
}

function userKey(username) {
  return `aoto:user:${username}`;
}

function configKey(username) {
  return `aoto:config:${username}`;
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

// Returns true if created, false if the username is already taken
async function createUser(username, password) {
  const { salt, hash } = await hashPassword(password);
  const record = JSON.stringify({ salt, hash, createdAt: new Date().toISOString() });
  const result = await redis(['SET', userKey(username), record, 'NX']);
  return result === 'OK';
}

const DUMMY_SALT = crypto.randomBytes(16).toString('base64');

async function verifyUser(username, password) {
  const user = USERNAME_RE.test(username) ? await getJson(userKey(username)) : null;
  // Hash even when the user does not exist so response time does not reveal it
  const { hash } = await hashPassword(String(password), user ? user.salt : DUMMY_SALT);
  if (!user) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'base64'), Buffer.from(user.hash, 'base64'));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

let cachedSecret = null;

async function getSecret() {
  if (cachedSecret) return cachedSecret;
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    const generated = crypto.randomBytes(32).toString('base64');
    await redis(['SET', 'aoto:session-secret', generated, 'NX']);
    secret = await redis(['GET', 'aoto:session-secret']);
  }
  cachedSecret = crypto.createHash('sha256').update(String(secret)).digest();
  return cachedSecret;
}

async function sign(payload) {
  return crypto.createHmac('sha256', await getSecret()).update(payload).digest('base64url');
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      try {
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch (e) { /* ignore malformed cookie */ }
    }
  });
  return out;
}

function isSecureRequest(req) {
  // Deployed Vercel URLs are always HTTPS; local `vercel dev` runs on plain http://localhost
  const deployed = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  return deployed || req.headers['x-forwarded-proto'] === 'https';
}

async function setSessionCookie(req, res, username) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${username}.${expiresAt}`;
  const value = `${payload}.${await sign(payload)}`;
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Returns the logged-in username, or null
async function getSessionUser(req) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [username, expiresAt, signature] = parts;
  if (!USERNAME_RE.test(username)) return null;
  if (!safeEqual(signature, await sign(`${username}.${expiresAt}`))) return null;
  if (!(Number(expiresAt) > Date.now())) return null;
  return username;
}

// Returns the username if the request may continue; otherwise sends 401 and returns null.
async function requireUser(req, res) {
  const username = await getSessionUser(req);
  if (!username) {
    sendJson(res, 401, { error: '로그인이 필요합니다.' });
    return null;
  }
  return username;
}

// ---------------------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------------------

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function tooManyFailures(req) {
  const count = Number(await redis(['GET', `aoto:authfail:${clientIp(req)}`])) || 0;
  return count >= MAX_AUTH_FAILURES;
}

async function recordFailure(req) {
  const key = `aoto:authfail:${clientIp(req)}`;
  const count = await redis(['INCR', key]);
  if (Number(count) === 1) await redis(['EXPIRE', key, AUTH_FAILURE_WINDOW_SEC]);
}

async function clearFailures(req) {
  await redis(['DEL', `aoto:authfail:${clientIp(req)}`]);
}

async function signupLimitReached(req) {
  const count = Number(await redis(['GET', `aoto:signups:${clientIp(req)}`])) || 0;
  return count >= MAX_SIGNUPS;
}

async function recordSignup(req) {
  const key = `aoto:signups:${clientIp(req)}`;
  const count = await redis(['INCR', key]);
  if (Number(count) === 1) await redis(['EXPIRE', key, SIGNUP_WINDOW_SEC]);
}

module.exports = {
  USERNAME_RE,
  MIN_PASSWORD_LENGTH,
  sendJson,
  readJsonBody,
  isJsonRequest,
  safeEqual,
  normalizeUsername,
  configKey,
  createUser,
  verifyUser,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  requireUser,
  tooManyFailures,
  recordFailure,
  clearFailures,
  signupLimitReached,
  recordSignup
};
