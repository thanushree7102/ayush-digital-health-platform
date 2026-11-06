// Face recognition for ALL account types (patient, doctor, clinic, admin).
//
// How it works
//  - The browser (face-api.js, models served from /models) turns a live camera image into a 128-number
//    template. The photo itself never leaves the browser; only the template is sent.
//  - One template per mobile number, shared by every role that number holds (a doctor who is also a patient
//    uses the same face). Templates are AES-256-GCM encrypted in the database (see security.js).
//  - Sign-in is a 1:1 check: "is this the face registered for THIS number?" - never a search of everyone.
//  - Registration requires a face step first (X-Face-Token header). Sign-in = face scan, then a fresh one-time code (otp.js).
//  - OTP-only sign-in stays available as a fallback (no camera, face not matching, lighting, etc.).
//
// Limits (be honest in any demo): there is no liveness check (no blink needed), so a photo or video of the
// person could be accepted. For real use add presentation-attack detection or a certified provider.
const db = require('./db');
const sec = require('./security');
const fs = require('fs');

const { uuid, now } = db;
const THRESHOLD = Number(process.env.FACE_THRESHOLD || 0.5); // euclidean distance; lower = stricter (face-api default is 0.6)
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const REQUIRED = process.env.FACE_REQUIRED !== '0';
const TOKEN_TTL = 10 * 60;

db.exec(`
CREATE TABLE IF NOT EXISTS face_profiles (
  face_id TEXT PRIMARY KEY,
  mobile_number TEXT NOT NULL UNIQUE,
  template_enc TEXT NOT NULL,                -- AES-256-GCM sealed 128-number template, never a photo
  liveness_checked INTEGER NOT NULL DEFAULT 0,
  consent_id TEXT REFERENCES consent_records(consent_id),
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS face_pending (   -- captured at the start of registration, promoted when the account is created
  token_id TEXT PRIMARY KEY,
  mobile_number TEXT NOT NULL,
  template_enc TEXT NOT NULL,
  liveness_checked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS face_attempts (
  attempt_id TEXT PRIMARY KEY,
  mobile_number TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('Passed','Failed')),
  distance REAL,
  created_at TEXT NOT NULL
);
`);

const ROLE_OF = { Patient: 'patient', Doctor: 'practitioner', 'Facility Representative': 'facility', Admin: 'admin' };
const validTemplate = (d) => Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 5)
  && d.some((x) => Math.abs(x) > 1e-4);
const distance = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
const usedTokens = new Map(); // nonce -> exp (single use)
const markUsed = (p) => { usedTokens.set(p.n, p.exp); for (const [k, v] of usedTokens) if (v < Date.now() / 1000) usedTokens.delete(k); };

const accountsFor = (mobile) => db.prepare('SELECT * FROM user_accounts WHERE mobile_number = ?').all(mobile);
const profileFor = (mobile) => db.prepare('SELECT * FROM face_profiles WHERE mobile_number = ?').get(mobile);

function locked(mobile) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60000).toISOString();
  const lastOk = db.prepare(`SELECT MAX(created_at) t FROM face_attempts WHERE mobile_number=? AND outcome='Passed'`).get(mobile).t || '';
  const fails = db.prepare(`SELECT COUNT(*) c FROM face_attempts WHERE mobile_number=? AND outcome='Failed' AND created_at > ? AND created_at > ?`).get(mobile, since, lastOk).c;
  return { fails, locked: fails >= MAX_FAILS };
}

function recordBiometric(mobile, status, purpose, consentId = null) {
  const u = accountsFor(mobile)[0];
  if (!u) return;
  db.prepare(`INSERT INTO biometric_verifications (biometric_verification_id,user_id,biometric_type,purpose,provider_or_device_reference,verification_status,consent_id,verified_at)
              VALUES (?,?, 'FACE', ?, 'browser face-api.js (128-d template)', ?, ?, ?)`).run(uuid(), u.user_id, purpose, status, consentId, now());
}

function saveProfile(mobile, sealed, liveness, userId) {
  const cid = uuid(); const t = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                VALUES (?,?,?, 'face recognition', 'v1', 'Granted', ?, 'Web')`).run(cid, userId || null, null, t);
    db.prepare(`INSERT INTO face_profiles (face_id,mobile_number,template_enc,liveness_checked,consent_id,created_at) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), mobile, sealed, liveness ? 1 : 0, cid, t);
    recordBiometric(mobile, 'Passed', 'Enrolment', cid);
  })();
}

module.exports = function install(v1, { checkOtp, audit, isMobile }) {
  // Does this number have accounts / a face? (used by the first screen)
  v1.post('/face/status', (req, res) => {
    const mobile = String((req.body || {}).mobile || '');
    if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    res.json({ faceRegistered: !!profileFor(mobile), accounts: [...new Set(accountsFor(mobile).filter((a) => a.account_status === 'Active').map((a) => ROLE_OF[a.account_type]))] });
  });

  // Register a face for a number: OTP proves the number, camera step gives the template.
  v1.post('/face/enroll', (req, res) => {
    const b = req.body || {};
    const mobile = String(b.mobile || '');
    if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    if (!(b.consent === true || b.consent === 'true')) return res.status(400).json({ message: 'Please agree to face recognition first.' });
    if (!validTemplate(b.descriptor)) return res.status(400).json({ message: 'The face could not be read. Please try again in good light.' });
    if (profileFor(mobile)) return res.status(409).json({ message: 'A face is already registered for this number. Use "Scan my face" to continue.' });
    const o = checkOtp(mobile, b.otp);
    if (!o.ok) return res.status(o.status).json({ message: o.message });
    const sealed = sec.seal(b.descriptor);
    const existing = accountsFor(mobile)[0];
    if (existing) { // e.g. account created on WhatsApp earlier: attach the face now
      saveProfile(mobile, sealed, true, existing.user_id);
      audit(req, { actor: existing.user_id, action: 'FACE_ENROLLED', type: 'user', ref: existing.user_id });
      return res.status(201).json({ faceToken: sec.sign({ k: 'verify', m: mobile }, TOKEN_TTL), attached: true });
    }
    const tid = uuid();
    db.prepare('INSERT INTO face_pending (token_id,mobile_number,template_enc,liveness_checked,expires_at) VALUES (?,?,?,1,?)')
      .run(tid, mobile, sealed, new Date(Date.now() + TOKEN_TTL * 1000).toISOString());
    return res.status(201).json({ faceToken: sec.sign({ k: 'enroll', m: mobile, t: tid }, TOKEN_TTL), attached: false });
  });

  // Compare a live face with the one registered for this number (1:1).
  v1.post('/face/verify', (req, res) => {
    const b = req.body || {};
    const mobile = String(b.mobile || '');
    if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    if (!validTemplate(b.descriptor)) return res.status(400).json({ message: 'The face could not be read. Please try again in good light.' });
    const prof = profileFor(mobile);
    if (!prof) return res.status(404).json({ message: 'No face is registered for this number.' });
    const l = locked(mobile);
    if (l.locked) return res.status(429).json({ message: `Too many face attempts. Use the OTP option, or try again in ${LOCK_MINUTES} minutes.` });
    const d = distance(sec.open(prof.template_enc), b.descriptor);
    const ok = d <= THRESHOLD;
    db.prepare('INSERT INTO face_attempts (attempt_id,mobile_number,outcome,distance,created_at) VALUES (?,?,?,?,?)').run(uuid(), mobile, ok ? 'Passed' : 'Failed', d, now());
    recordBiometric(mobile, ok ? 'Passed' : 'Failed', 'Sign-in');
    if (!ok) {
      audit(req, { action: 'FACE_VERIFY', type: 'user', result: 'Failure', reason: 'no match' });
      return res.status(401).json({ message: 'This face does not match the one registered for this number.', attemptsLeft: Math.max(0, MAX_FAILS - l.fails - 1) });
    }
    return res.json({ ok: true, faceToken: sec.sign({ k: 'verify', m: mobile }, TOKEN_TTL) });
  });

  // Registration gate: every register route runs this. It needs a face token for the same mobile number and,
  // once the account is created, saves the face so the person can sign in with it next time.
  function faceGate(req, res, next) {
    const mobile = String((req.body || {}).mobile || '');
    const p = sec.verify(req.get('X-Face-Token'));
    const dropFile = () => { if (req.file) fs.unlink(req.file.path, () => {}); }; // certificate already uploaded by multer
    if (!p) {
      dropFile();
      if (!REQUIRED) return next();
      return res.status(400).json({ message: 'Please complete the face step first.', errors: { face: 'Face registration is required' } });
    }
    if (!['enroll', 'verify'].includes(p.k) || p.m !== mobile) { dropFile(); return res.status(403).json({ message: 'The face step was done for a different mobile number.', errors: { face: 'Face does not belong to this number' } }); }
    res.on('finish', () => {
      if (res.statusCode !== 201) return;
      try {
        const u = db.prepare('SELECT * FROM user_accounts WHERE mobile_number = ? ORDER BY created_at DESC LIMIT 1').get(mobile);
        if (p.k === 'enroll' && u && !profileFor(mobile)) {
          const pend = db.prepare('SELECT * FROM face_pending WHERE token_id = ? AND mobile_number = ?').get(p.t, mobile);
          if (pend) saveProfile(mobile, pend.template_enc, pend.liveness_checked, u.user_id);
        }
        if (p.k === 'enroll') db.prepare('DELETE FROM face_pending WHERE token_id = ?').run(p.t);
      } catch (e) { console.error('face save failed', e.message); }
    });
    return next();
  }

  // Used by /auth/login: a face token replaces the OTP (single use).
  // peek: is this face token good? (does not use it up, so a wrong OTP does not waste the face scan)
  function peekFaceLogin(token, mobile) {
    const p = sec.verify(token);
    if (!p || p.m !== mobile || usedTokens.has(p.n)) return false;
    return p.k === 'verify' || (p.k === 'enroll' && !!profileFor(mobile));
  }
  function consumeFaceLogin(token, mobile) {
    if (!peekFaceLogin(token, mobile)) return false;
    markUsed(sec.verify(token));
    return true;
  }

  return { faceGate, consumeFaceLogin, peekFaceLogin, profileFor, ROLE_OF };
};
