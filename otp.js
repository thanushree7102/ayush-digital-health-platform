// One-time passwords: a NEW random 6-digit code for every person and every request.
//  - Stored only as a keyed hash, valid 5 minutes, single use, 5 wrong tries burn the code.
//  - A number can ask for a new code every 30 seconds, at most 6 per hour.
//  - After a code is accepted the number is "proven" for 10 minutes: registration steps that follow
//    (face enrol -> details form -> submit) do not ask for a second code.
//  - Set OTP_CODE in .env only if you want ONE fixed code for everybody (old demo behaviour, handy for tests).
const crypto = require('crypto');
const sec = require('./security');

const TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const MAX_SENDS_PER_HOUR = 6;
const MAX_TRIES = 5;
const PROOF_MS = 10 * 60 * 1000;
const FIXED = String(process.env.OTP_CODE || '').trim();

const codes = new Map();   // mobile -> { hash, exp, tries, sentAt }
const sends = new Map();   // mobile -> [timestamps]
const proofs = new Map();  // mobile -> expiry

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sweep = () => { const t = Date.now(); for (const [k, v] of codes) if (v.exp < t) codes.delete(k); for (const [k, v] of proofs) if (v < t) proofs.delete(k); };

// -> { ok:true, code, expiresIn } | { ok:false, wait?:seconds, message }
function issue(mobile) {
  sweep();
  const t = Date.now();
  const prev = codes.get(mobile);
  if (prev && t - prev.sentAt < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (t - prev.sentAt)) / 1000);
    return { ok: false, wait, message: `Please wait ${wait} seconds before asking for a new OTP.` };
  }
  const recent = (sends.get(mobile) || []).filter((x) => t - x < 3600000);
  if (recent.length >= MAX_SENDS_PER_HOUR) return { ok: false, wait: 600, message: 'Too many OTP requests. Try again in a while.' };
  recent.push(t); sends.set(mobile, recent);
  const code = FIXED || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  codes.set(mobile, { hash: sec.hmac(`${mobile}:${code}`), exp: t + TTL_MS, tries: 0, sentAt: t });
  return { ok: true, code, expiresIn: TTL_MS / 1000, resendIn: COOLDOWN_MS / 1000 };
}

// true when `code` is the live code for this number. A right code is used up; a wrong one counts against the 5 tries.
function verify(mobile, code) {
  sweep();
  const c = String(code || '');
  if (FIXED && same(c, FIXED)) { codes.delete(mobile); return true; }
  const e = codes.get(mobile);
  if (!e || !/^\d{6}$/.test(c)) return false;
  if (same(sec.hmac(`${mobile}:${c}`), e.hash)) { codes.delete(mobile); return true; }
  e.tries += 1;
  if (e.tries >= MAX_TRIES) codes.delete(mobile);
  return false;
}

const prove = (mobile) => { proofs.set(mobile, Date.now() + PROOF_MS); };
const isProven = (mobile) => { sweep(); return proofs.has(mobile); };
const useProof = (mobile) => { const ok = isProven(mobile); if (ok) proofs.delete(mobile); return ok; };

module.exports = { issue, verify, prove, isProven, useProof, TTL_MS, fixed: !!FIXED };
