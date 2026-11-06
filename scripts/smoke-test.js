// End-to-end check of the backend (no browser needed):  npm run smoke
// Starts its own server on a temporary database, then walks through face enrol/verify for every role,
// demo Aadhaar fetch, sign-in by face, "my details", and a full WhatsApp registration + record (typed, edit, safety check, view by system, unregister) in all 3 languages.
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = 4300 + Math.floor(Math.random() * 400);
const DB = path.join(os.tmpdir(), `ayush-smoke-${process.pid}.db`);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0; let fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const j = async (p, o = {}) => {
  const r = await fetch(BASE + p, { ...o, headers: { ...(o.json ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) }, body: o.json ? JSON.stringify(o.json) : o.body });
  let body = null; try { body = await r.json(); } catch (e) { /* empty */ }
  return { s: r.status, b: body };
};
const face = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7.1 + i * 0.37) * 0.2);
const noisy = (d, n = 0.01) => d.map((x, i) => x + Math.cos(i) * n);
const wa = async (from, text, extra = {}) => (await j('/whatsapp-mock', { method: 'POST', json: { from, text, ...extra } })).b;
const flat = (a) => a.map((x) => x.text + (x.options ? ` [${x.options.join(' | ')}]` : '')).join('\n');

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DB_FILE: DB, WHATSAPP_MODE: 'mock', OTP_CODE: '123456', AYUSH_SECRET: 'smoke-test-secret' }, cwd: path.join(__dirname, '..') });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }

  try {
    console.log('Face + patient registration');
    const M1 = '9811100001'; const f1 = face(1);
    let r = await j('/v1/face/status', { method: 'POST', json: { mobile: M1 } });
    ok(r.s === 200 && r.b.faceRegistered === false && r.b.accounts.length === 0, 'new number: no face, no account');
    const reg = { name: 'Test Patient', mobile: M1, otp: '123456', consent: true, dob: '1990-01-01', gender: 'Female' };
    r = await j('/v1/auth/register', { method: 'POST', json: reg });
    ok(r.s === 400 && r.b.errors?.face, 'registration without a face step is refused');
    r = await j('/v1/face/enroll', { method: 'POST', json: { mobile: M1, otp: '000000', descriptor: f1, liveness: true, consent: true } });
    ok(r.s === 401, 'enrol with wrong OTP is refused');
    r = await j('/v1/face/enroll', { method: 'POST', json: { mobile: M1, otp: '123456', descriptor: f1, liveness: true, consent: true } });
    ok(r.s === 201 && r.b.faceToken, 'enrol face (OTP + liveness + consent)');
    const enrolTok = r.b.faceToken;
    r = await j('/v1/auth/register', { method: 'POST', json: { ...reg, mobile: '9811100002' }, headers: { 'X-Face-Token': enrolTok } });
    ok(r.s === 403, 'face token for another number is refused');
    r = await j('/v1/auth/register', { method: 'POST', json: reg, headers: { 'X-Face-Token': enrolTok } });
    ok(r.s === 201 && r.b.healthId, 'patient registered with face token', JSON.stringify(r.b));
    r = await j('/v1/face/status', { method: 'POST', json: { mobile: M1 } });
    ok(r.b.faceRegistered === true && r.b.accounts.includes('patient'), 'status now shows face + patient account');

    console.log('Face sign-in');
    r = await j('/v1/face/verify', { method: 'POST', json: { mobile: M1, descriptor: face(2), liveness: true } });
    ok(r.s === 401, 'a different face is rejected');
    r = await j('/v1/face/verify', { method: 'POST', json: { mobile: M1, descriptor: noisy(f1), liveness: true } });
    ok(r.s === 200 && r.b.faceToken, 'same face (small camera noise) is accepted');
    const vt = r.b.faceToken;
    r = await j('/v1/auth/login', { method: 'POST', json: { mobile: M1, role: 'patient', faceToken: vt, otp: '000000' } });
    ok(r.s === 401, 'face + wrong OTP is refused (and does not waste the face scan)');
    r = await j('/v1/auth/login', { method: 'POST', json: { mobile: M1, role: 'patient', faceToken: vt, otp: '123456' } });
    ok(r.s === 200 && r.b.token && r.b.method === 'face + otp' && r.b.healthId, 'login by face + OTP');
    const tok = r.b.token;
    r = await j('/v1/auth/login', { method: 'POST', json: { mobile: M1, role: 'patient', faceToken: vt, otp: '123456' } });
    ok(r.s === 401, 'a face token cannot be used twice');
    r = await j('/v1/me', { headers: { Authorization: `Bearer ${tok}` } });
    ok(r.s === 200 && r.b.name === 'Test Patient' && r.b.details['Date of birth'] === '1990-01-01', 'my details fetched after face sign-in');
    r = await j('/v1/me');
    ok(r.s === 401, 'my details need a token');
    const stranger = (i) => f1.map((x, k) => -x + k * 0.001 * (i + 1)); // clearly a different face
    for (let i = 0; i < 5; i++) await j('/v1/face/verify', { method: 'POST', json: { mobile: M1, descriptor: stranger(i), liveness: true } });
    r = await j('/v1/face/verify', { method: 'POST', json: { mobile: M1, descriptor: noisy(f1), liveness: true } });
    ok(r.s === 429, 'face sign-in locks after repeated failures (OTP still works)');
    r = await j('/v1/auth/login', { method: 'POST', json: { mobile: M1, role: 'patient', otp: '123456' } });
    ok(r.s === 200 && r.b.method === 'otp', 'OTP fallback still signs in');

    console.log('Demo Aadhaar');
    r = await j('/v1/aadhaar/fetch', { method: 'POST', json: { aadhaar: '234567890124' } });
    ok(r.s === 400, 'needs consent');
    r = await j('/v1/aadhaar/fetch', { method: 'POST', json: { aadhaar: '234567890124', consent: true } });
    ok(r.s === 200 && r.b.name === 'Ananya Rao' && r.b.city === 'Bengaluru' && r.b.maskedAadhaar === 'XXXX XXXX 0124', 'demo Aadhaar returns details');
    r = await j('/v1/aadhaar/fetch', { method: 'POST', json: { aadhaar: '234567890125', consent: true } });
    ok(r.s === 400, 'bad checksum is rejected');

    console.log('Same face for every role');
    const fd = new FormData();
    Object.entries({ name: 'Dr Test', system: 'Ayurveda', qualification: 'BAMS', council: 'Central Council of Indian Medicine (CCIM)', registrationNo: 'REG-9', mobile: M1, otp: '123456' }).forEach(([k, v]) => fd.append(k, v));
    fd.append('certificate', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'c.pdf');
    r = await j('/v1/face/verify', { method: 'POST', json: { mobile: M1, descriptor: noisy(f1), liveness: true } }); // locked above; OTP-login path instead
    const o2 = await j('/v1/face/enroll', { method: 'POST', json: { mobile: M1, otp: '123456', descriptor: f1, liveness: true, consent: true } });
    ok(o2.s === 409, 'a number that already has a face cannot enrol a second one');
    const M2 = '9811100003'; const e2 = await j('/v1/face/enroll', { method: 'POST', json: { mobile: M2, otp: '123456', descriptor: face(3), liveness: true, consent: true } });
    const fd2 = new FormData();
    Object.entries({ name: 'Dr Test', system: 'Ayurveda', qualification: 'BAMS', council: 'Central Council of Indian Medicine (CCIM)', registrationNo: 'REG-9', mobile: M2, otp: '123456' }).forEach(([k, v]) => fd2.append(k, v));
    fd2.append('certificate', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'c.pdf');
    r = await j('/v1/auth/register/practitioner', { method: 'POST', body: fd2, headers: { 'X-Face-Token': e2.b.faceToken } });
    ok(r.s === 201 && r.b.needsApproval, 'doctor registered with face (waits for admin approval)', JSON.stringify(r.b));
    r = await j('/v1/auth/register/facility', { method: 'POST', body: (() => { const f = new FormData(); Object.entries({ name: 'Test Clinic', facilityType: 'Clinic', licenceNo: 'L-1', address: 'MG Road', state: 'Karnataka', pincode: '560001', mobile: '9811100004', otp: '123456' }).forEach(([k, v]) => f.append(k, v)); f.append('systems', 'Ayurveda'); f.append('certificate', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'l.pdf'); return f; })(), headers: { 'X-Face-Token': (await j('/v1/face/enroll', { method: 'POST', json: { mobile: '9811100004', otp: '123456', descriptor: face(4), liveness: true, consent: true } })).b.faceToken } });
    ok(r.s === 201, 'clinic registered with face', JSON.stringify(r.b));
    const e5 = await j('/v1/face/enroll', { method: 'POST', json: { mobile: '9811100005', otp: '123456', descriptor: face(5), liveness: true, consent: true } });
    r = await j('/v1/auth/register/admin', { method: 'POST', json: { name: 'Adm Test', adminType: 'Auditor', designation: 'QA', department: 'Health', email: 'adm@test.in', mobile: '9811100005', otp: '123456', inviteCode: 'AYUSH-ADMIN-2026' }, headers: { 'X-Face-Token': e5.b.faceToken } });
    ok(r.s === 201, 'admin registered with face', JSON.stringify(r.b));
    r = await j('/v1/face/status', { method: 'POST', json: { mobile: '9811100005' } });
    ok(r.b.faceRegistered && r.b.accounts.includes('admin'), 'admin face saved after registration');
    r = await j('/v1/auth/login', { method: 'POST', json: { mobile: '9811100005', role: 'admin', faceToken: (await j('/v1/face/verify', { method: 'POST', json: { mobile: '9811100005', descriptor: noisy(face(5)), liveness: true } })).b.faceToken } });
    ok(r.s === 200 && r.b.role === 'admin', 'admin signs in by face');
    r = await j('/v1/me', { headers: { Authorization: `Bearer ${r.b.token}` } });
    ok(r.s === 200 && r.b.codeLabel === 'Admin ID', 'admin details fetched');

    console.log('WhatsApp bot (mock transport)');
    const P = '919876500011';
    let out = flat(await wa(P, 'Hi'));
    ok(/lang_en/.test(out) && /lang_kn/.test(out), 'asks for a language first');
    out = flat(await wa(P, 'lang_kn'));
    ok(/ಕನ್ನಡಕ್ಕೆ/.test(out) && /ನೋಂದಣಿ/.test(out), 'Kannada selected, opt-in in Kannada');
    out = flat(await wa(P, 'yes')); ok(/ಹೆಸರೇನು/.test(out), 'asks the name in Kannada');
    out = flat(await wa(P, 'Kavya N')); ok(/ಜನ್ಮ ದಿನಾಂಕ/.test(out), 'asks date of birth');
    out = flat(await wa(P, 'tomorrow')); ok(/14-03-1996/.test(out), 'rejects a bad date');
    out = flat(await wa(P, '14-03-1996')); ok(/ಅಲರ್ಜಿ/.test(out), 'asks allergies');
    out = flat(await wa(P, 'penicillin')); ok(/ಒಪ್ಪುತ್ತೀರಾ/.test(out), 'asks consent');
    out = flat(await wa(P, 'yes')); ok(/91-\d{4}-\d{4}-\d{4}/.test(out) && /m_summary/.test(out), 'registered, health ID + menu');
    const pat = await j('/v1/face/status', { method: 'POST', json: { mobile: P.slice(-10) } });
    ok(pat.b.accounts.includes('patient') && pat.b.faceRegistered === false, 'WhatsApp patient exists on the website side (no face yet)');
    out = flat(await wa(P, 'm_add')); ok(/ತ್ರಿಫಲ/.test(out), 'add-by-typing prompt');
    out = flat(await wa(P, 'Ayurveda. Fever 3 days. Triphala churna 5 g at night for 30 days'));
    ok(/Triphala churna/i.test(out) && /save/.test(out), 'typed description understood', out);
    out = flat(await wa(P, 'save')); ok(/ಉಳಿಸಲಾಗಿದೆ/.test(out), 'record saved');
    out = flat(await wa(P, 'm_meds')); ok(/Triphala/i.test(out), 'medicines list shows it');
    out = flat(await wa(P, 'm_allergy')); ok(/penicillin/.test(out), 'allergies shown');
    out = flat(await wa(P, 'm_add')); out = flat(await wa(P, 'Ayurveda. Penicillin tablet 500 mg twice a day for 5 days'));
    out = flat(await wa(P, 'edit')); ok(/f_doctor/.test(out) && /f_addmed/.test(out), 'edit lists the fields');
    out = flat(await wa(P, 'f_doctor')); out = flat(await wa(P, 'Dr Rao')); ok(/Dr Rao/.test(out) && /save/.test(out), 'edited field shows in the draft');
    out = flat(await wa(P, 'save')); ok(/penicillin/i.test(out) && /yes/.test(out), 'safety check warns about an allergy before saving');
    out = flat(await wa(P, 'yes')); ok(/Saved|ಉಳಿಸಲಾಗಿದೆ/.test(out) && /⚠/.test(out), 'saved anyway, warning kept in the summary');
    out = flat(await wa(P, 'm_system')); ok(/sys_ayurveda/.test(out), 'view by system lists systems');
    out = flat(await wa(P, 'sys_ayurveda')); ok(/Triphala/i.test(out), 'view by system shows that system');
    out = flat(await wa(P, 'lang_hi')); ok(/हिन्दी/.test(out), 'switch to Hindi');
    out = flat(await wa(P, 'm_summary')); ok(/स्वास्थ्य आईडी/.test(out) && /सहेजे रिकॉर्ड: 2/.test(out), 'summary in Hindi');
    out = flat(await wa(P, '', { audio: { mime: 'audio/ogg', base64: 'AAAA' } })); ok(/वॉइस नोट/.test(out), 'voice note: clear message when no speech-to-text is configured');
    out = flat(await wa(P, 'm_grant')); ok(/grant_D-1/.test(out), 'doctor list for sharing');
    out = flat(await wa(P, 'grant_D-1')); ok(/30/.test(out), 'access granted');
    out = flat(await wa(P, 'm_access')); ok(/Dr\. Ayurveda Demo/.test(out), 'access list');
    const web = await j('/v1/auth/login', { method: 'POST', json: { mobile: P.slice(-10), role: 'patient', otp: '123456' } });
    ok(web.s === 200 && web.b.name === 'Kavya N', 'same patient signs in on the website (OTP) after WhatsApp registration');
    const enr = await j('/v1/face/enroll', { method: 'POST', json: { mobile: P.slice(-10), otp: '123456', descriptor: face(7), liveness: true, consent: true } });
    ok(enr.s === 201 && enr.b.attached, 'face can be added later to a WhatsApp-created account');
    out = flat(await wa(P, 'bye')); ok(/सुरक्षित/.test(out), 'bye ends the chat');
    out = flat(await wa(P, 'm_delete')); ok(/del_yes/.test(out), 'unregister asks to confirm');
    out = flat(await wa(P, 'del_yes')); ok(/deleted/.test(out), 'unregister deletes the account');
    const gone = await j('/v1/face/status', { method: 'POST', json: { mobile: P.slice(-10) } });
    ok(!gone.b.accounts.includes('patient'), 'patient no longer exists on the website side');
  } catch (e) { fail++; console.error('TEST CRASHED', e); }

  srv.kill();
  for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) fs.rmSync(f, { force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
