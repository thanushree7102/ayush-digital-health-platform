// Shared security helpers: signed tokens (sessions, face tokens) and encryption of face templates.
// Keys come from AYUSH_SECRET (set it in production). If it is not set, a random secret is created once
// and kept in ayush.secret (git-ignored) so tokens and stored face templates survive a restart.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecret() {
  if (process.env.AYUSH_SECRET) return process.env.AYUSH_SECRET;
  const f = path.join(__dirname, 'ayush.secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* create below */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', SECRET, 'ayush', label, 32));
const TOKEN_KEY = derive('token');
const FACE_KEY = derive('face-template');

const b64 = (b) => Buffer.from(b).toString('base64url');

// sign({ ...payload }, ttlSeconds) -> "payload.signature"
function sign(payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: crypto.randomBytes(6).toString('hex') }));
  const sig = crypto.createHmac('sha256', TOKEN_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', TOKEN_KEY).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}

// Face templates (128 numbers) are AES-256-GCM encrypted before they touch the database.
function seal(arr) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', FACE_KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(arr), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function open(s) {
  const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', FACE_KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

// keyed hash (stores one-time codes without keeping the code itself)
const hmac = (text) => crypto.createHmac('sha256', TOKEN_KEY).update(String(text)).digest('hex');

module.exports = { sign, verify, seal, open, hmac };
