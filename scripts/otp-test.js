// Checks the one-time-code rules with NO fixed OTP: every person gets a different random code,
// it is single use, wrong codes are refused, and face sign-in needs the code too.   npm run test:otp
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = 4800 + Math.floor(Math.random() * 300);
const DB = path.join(os.tmpdir(), `ayush-otp-${process.pid}.db`);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0; let fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const j = async (p, json) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  let b = null; try { b = await r.json(); } catch (e) { /* empty */ }
  return { s: r.status, b };
};
const face = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7.1 + i * 0.37) * 0.2);

(async () => {
  const env = { ...process.env, PORT, DB_FILE: DB, WHATSAPP_MODE: 'mock', AYUSH_SECRET: 'otp-test-secret' };
  delete env.OTP_CODE;
  const srv = spawn('node', ['server.js'], { env, cwd: path.join(__dirname, '..') });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }
  try {
    console.log('One-time codes');
    const A = '9822200001'; const B = '9822200002';
    let r = await j('/v1/auth/otp/send', { mobile: 'abc' });
    ok(r.s === 400, 'bad number is refused');
    const a = await j('/v1/auth/otp/send', { mobile: A });
    const b = await j('/v1/auth/otp/send', { mobile: B });
    ok(a.s === 200 && /^\d{6}$/.test(a.b.demoOtp) && b.s === 200 && /^\d{6}$/.test(b.b.demoOtp), 'each number gets a 6-digit code');
    ok(a.b.demoOtp !== b.b.demoOtp && a.b.demoOtp !== '123456', 'codes differ per person and are not the old fixed 123456');
    ok(log.includes(`+91 ${A}`) && log.includes(a.b.demoOtp), 'the code is also printed in the server terminal');
    r = await j('/v1/auth/otp/send', { mobile: A });
    ok(r.s === 429 && r.b.wait > 0, 'asking again at once is refused (30 s wait)');
    r = await j('/v1/auth/otp/confirm', { mobile: A, otp: b.b.demoOtp });
    ok(r.s === 401, "someone else's code does not work for this number");
    r = await j('/v1/auth/otp/confirm', { mobile: A, otp: a.b.demoOtp });
    ok(r.s === 200, 'the right code is accepted');
    r = await j('/v1/auth/otp/confirm', { mobile: A, otp: a.b.demoOtp });
    ok(r.s === 401, 'a code cannot be used twice');

    console.log('Face first, then OTP (registration)');
    const f = face(11);
    r = await j('/v1/face/enroll', { mobile: B, otp: '000000', descriptor: f, liveness: true, consent: true });
    ok(r.s === 401, 'face enrol with a wrong code is refused');
    r = await j('/v1/face/enroll', { mobile: B, otp: b.b.demoOtp, descriptor: f, liveness: true, consent: true });
    ok(r.s === 201 && r.b.faceToken, 'face enrol with the code sent to this number');
    r = await fetch(`${BASE}/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Face-Token': r.b.faceToken }, body: JSON.stringify({ name: 'Otp Tester', mobile: B, dob: '1991-02-03', gender: 'Female', consent: true }) });
    ok(r.status === 201, 'details step needs no second code', String(r.status));
    // after the 2-minute window an account needs face + a NEW code: simulate by asking for a new code and signing in
    const v = await j('/v1/face/verify', { mobile: B, descriptor: f, liveness: true });
    ok(v.s === 200, 'face matches');
    await new Promise((x) => setTimeout(x, 100));
    r = await j('/v1/auth/login', { mobile: B, role: 'patient', faceToken: v.b.faceToken, otp: '111111' });
    ok(r.s === 401, 'face + wrong code is refused');
    console.log('  (waiting 31 s for the resend limit...)');
    await new Promise((x) => setTimeout(x, 31000));
    const n = await j('/v1/auth/otp/send', { mobile: B });
    ok(n.s === 200 && /^\d{6}$/.test(n.b.demoOtp), 'a new code can be requested after 30 s');
    r = await j('/v1/auth/login', { mobile: B, role: 'patient', faceToken: v.b.faceToken, otp: n.b.demoOtp });
    ok(r.s === 200 && r.b.method === 'face + otp' && r.b.token, 'face + the new code signs in (the earlier wrong try did not waste the face scan)');
  } finally { srv.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
