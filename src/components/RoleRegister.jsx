import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { platform } from '../api/client';
import { useLang } from '../i18n';
import { listenAlts, SKIP_WORDS, speak, speechInSupported, STOP_WORDS, stopListening } from '../voice/speech';
import { onlyDigits } from '../utils/aadhaar';
import { setSession } from '../utils/session';
import AadhaarFetch from './AadhaarFetch';
import FaceCapture, { warmFace } from './FaceCapture';
import Field from './Field';
import OtpBox from './OtpBox';
import TopBar from './TopBar';
import { applySpoken } from './VoiceMic';

const HOME = { patient: '/patient/profile', practitioner: '/me', facility: '/me', admin: '/admin' };
const ROLE_LABEL = { patient: 'Patient', practitioner: 'Doctor', facility: 'Clinic / Hospital', admin: 'Admin / Auditor' };
const errText = (err, t) => {
  const c = err.response?.status;
  return c && c < 500 ? t(err.response.data?.message || 'Please check the details.') : t('Could not reach the server. Retry in a moment.');
};

// ONE registration flow for every role:  1) mobile number + face (same step for everybody)
//                                        2) role details, with optional demo-Aadhaar fetch
export default function RoleRegister({ role, title, intro, endpoint, fields, steps, aadhaarFill = [], json = false, aadhaarLink = false }) {
  const { t, lang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const init = Object.fromEntries(fields.map((f) => [f.name, f.type === 'multiselect' ? [] : '']));
  const [stage, setStage] = useState('face');
  useEffect(() => { warmFace(); }, []); // load the face models while the form is being filled
  const [mobile, setMobile] = useState(loc.state?.mobile || '');
  const [otp, setOtp] = useState('');
  const [faceConsent, setFaceConsent] = useState(false);
  const [faceMsg, setFaceMsg] = useState(null);
  const [faceToken, setFaceToken] = useState('');
  const [cap, setCap] = useState(null);     // face captured in the browser, waiting for the OTP step
  const [faceOk, setFaceOk] = useState(false); // true when this number's registered face already matched
  const [sharedFace, setSharedFace] = useState(false);
  const [v, setV] = useState({ ...init, mobile: loc.state?.mobile || '', abha: '', declare: false });
  const [aadhaar, setAadhaar] = useState('');
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [guided, setGuided] = useState(false);
  const stopGuide = useRef(false);

  const set = (k, val) => { setV((p) => ({ ...p, [k]: val })); setMsg(''); };

  // ---------- step 1: mobile -> face scan -> a NEW OTP is sent -> details ----------
  const onFace = async (c) => {
    setFaceMsg(null);
    if (!/^[6-9]\d{9}$/.test(mobile)) return setFaceMsg({ ok: false, text: t('Enter a valid 10-digit mobile number') });
    try {
      const st = (await platform.post('/face/status', { mobile })).data;
      if (st.faceRegistered) { // this number already has a face (another role, or WhatsApp): just check it
        const r = await platform.post('/face/verify', { mobile, descriptor: c.descriptor, liveness: true });
        setFaceToken(r.data.faceToken); setSharedFace(true); setFaceOk(true);
      } else { setCap(c); setFaceOk(false); }
      setOtp(''); setStage('otp'); // face found -> now the OTP is sent
    } catch (err) { setFaceMsg({ ok: false, text: errText(err, t) }); }
  };
  const confirmOtp = async () => {
    setFaceMsg(null);
    if (!/^\d{6}$/.test(otp)) return setFaceMsg({ ok: false, text: t('Enter the 6-digit OTP') });
    setBusy(true);
    try {
      if (faceOk) await platform.post('/auth/otp/confirm', { mobile, otp });
      else {
        const r = await platform.post('/face/enroll', { mobile, otp, descriptor: cap.descriptor, liveness: true, consent: true });
        setFaceToken(r.data.faceToken);
      }
      setV((p) => ({ ...p, mobile }));
      setStage('form');
    } catch (err) { setFaceMsg({ ok: false, text: errText(err, t) }); } finally { setBusy(false); }
  };
  const rescan = () => { setStage('face'); setCap(null); setFaceToken(''); setFaceOk(false); setSharedFace(false); setOtp(''); setFaceMsg(null); };
  const faceReady = /^[6-9]\d{9}$/.test(mobile) && faceConsent;

  // ---------- step 2: details ----------
  const fill = (d) => {
    const all = { name: d.name, dob: d.dob, gender: d.gender, addressLine: d.addressLine, address: d.addressLine, city: d.city, state: d.state, pincode: d.pincode, email: d.email };
    setV((p) => {
      const n = { ...p };
      fields.forEach((f) => {
        if (!aadhaarFill.includes(f.name) || all[f.name] === undefined || all[f.name] === '') return;
        if (f.type === 'select' && !f.options.includes(all[f.name])) return;
        if (f.name === 'email' && p.email) return;
        n[f.name] = all[f.name];
      });
      return n;
    });
  };

  const validate = () => {
    const e = {};
    fields.forEach((f) => {
      const x = v[f.name];
      if (f.required && (Array.isArray(x) ? !x.length : !String(x).trim())) e[f.name] = `${f.label} is required`;
      else if (f.pattern && x && !f.pattern.test(x)) e[f.name] = f.patternMsg;
    });
    if (steps.certificate && !file) e.certificate = steps.certificate.error;
    if (!v.declare) e.declare = 'Please accept the declaration';
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { declare, abha, ...rest } = v;
      const headers = { 'X-Face-Token': faceToken };
      let r;
      if (json) {
        const body = { ...rest, otp, consent: true };
        if (abha) body.abha = abha;
        if (aadhaarLink && aadhaar) { body.aadhaar = aadhaar; body.identityConsent = true; }
        r = await platform.post(endpoint, body, { headers });
      } else {
        const fd = new FormData();
        Object.entries({ ...rest, otp }).forEach(([k, val]) => {
          if (Array.isArray(val)) val.forEach((x) => fd.append(k, x));
          else if (val !== '') fd.append(k, val);
        });
        if (file) fd.append('certificate', file);
        r = await platform.post(endpoint, fd, { headers });
      }
      setAadhaar('');
      const out = r.data;
      // accounts that need no approval are signed in straight away with the face just captured
      if (!out.needsApproval) {
        try {
          const l = await platform.post('/auth/login', { mobile, role, faceToken });
          setSession({ ...l.data, mobile });
          return nav(HOME[role]);
        } catch (e2) { /* fall through to the confirmation card */ }
      }
      setDone(out);
    } catch (err) {
      if (err.response?.data?.errors) setErrors(err.response.data.errors);
      setMsg(errText(err, t));
    } finally { setBusy(false); }
  };

  // "Fill this form by voice": asks each field out loud, listens, fills it in
  const guide = async () => {
    if (guided) { stopGuide.current = true; stopListening(); return; }
    setGuided(true); stopGuide.current = false;
    const list = fields.filter((f) => !['date', 'multiselect'].includes(f.type) && f.name !== 'mobile');
    for (const f of list) {
      if (stopGuide.current) break;
      document.getElementById(`f-${f.name}`)?.scrollIntoView({ block: 'center' });
      setMsg(`🎤 ${t(f.label)}`);
      await speak(t(f.label), lang);
      try {
        const isDigits = !!f.digits;
        const alts = await listenAlts(lang, { silenceMs: isDigits ? 3000 : 1800, onInterim: (x) => x && setMsg(`🎤 ${t(f.label)}: ${x}`) });
        if (alts.some((a) => SKIP_WORDS.test(a.trim()))) continue;
        if (alts.some((a) => STOP_WORDS.test(a.trim()))) break;
        const mode = f.type === 'select' ? 'select' : f.type === 'email' ? 'email' : f.digits ? 'digits' : f.type === 'textarea' ? 'area' : 'text';
        set(f.name, applySpoken(alts, { mode, options: f.options || [], digits: f.digits, current: v[f.name] }, t));
      } catch (x) { setMsg(x.message); }
    }
    setGuided(false); stopListening(); setMsg(t('Done. Please check the fields, then submit.'));
  };

  // ---------- screens ----------
  if (done) {
    const id = done.id || done.healthId;
    return (
      <>
        <TopBar />
        <div className="container"><div className="card center">
          <h2>{done.needsApproval ? t('Registration submitted') : t('Account created')}</h2>
          {done.message && <p className="muted">{t(done.message)}</p>}
          <div className="hid">{id}</div>
          <p className="muted">{t(done.idLabel || 'Health Record ID')}</p>
          <div className="banner ok">{t('Your face is registered. Next time, enter your mobile number and scan your face to sign in.')}</div>
          {done.needsApproval && <div className="banner info">{t('Status: waiting for admin verification. You cannot sign in until approved.')}</div>}
          <Link to="/"><button type="button">{t('Go to sign in')}</button></Link>
        </div></div>
      </>
    );
  }

  if (stage === 'face') {
    return (
      <>
        <TopBar />
        <div className="container"><div className="card">
          <Link to="/register" className="muted">← {t('Choose a different account type')}</Link>
          <h2 style={{ marginTop: 8 }}>{t(title)}</h2>
          <div className="steps"><span className="on">1. {t('Face registration')}</span><span>2. {t('Your details')}</span></div>
          <p className="muted">{t('Everyone registers the same way: mobile number, a quick face scan and a one-time OTP. After that you fill in the details for your account type.')}</p>
          {faceMsg && <div className={`banner ${faceMsg.ok ? 'ok' : 'err'}`}>{faceMsg.text}</div>}
          <Field field={{ name: 'mobile', label: 'Mobile number', digits: 10, required: true }} value={mobile} error={mobile && !/^[6-9]\d{9}$/.test(mobile) ? 'Enter a valid 10-digit mobile number' : ''} onChange={(n, val) => setMobile(onlyDigits(val, 10))} />
          <label className="check"><input type="checkbox" checked={faceConsent} onChange={(e) => setFaceConsent(e.target.checked)} />
            {t('I agree to face recognition. My photo is not stored, only a protected face template.')}</label>
          <FaceCapture disabled={!faceReady} buttonLabel={`📷 ${t('Scan my face')}`} onCaptured={onFace} />
          {!faceReady && <p className="muted">{t('Enter your number and tick the agreement to turn the camera on.')}</p>}
        </div></div>
      </>
    );
  }

  if (stage === 'otp') {
    return (
      <>
        <TopBar />
        <div className="container"><div className="card">
          <h2>{t(title)}</h2>
          <div className="steps"><span className="on">1. {t('Face registration')}</span><span>2. {t('Your details')}</span></div>
          <div className="banner ok">{faceOk ? t('Your face matched the one already registered for this number.') : t('Face found.')}</div>
          <p className="muted">{t('One more check: we sent a new OTP to this number.')}</p>
          {faceMsg && <div className={`banner ${faceMsg.ok ? 'ok' : 'err'}`}>{faceMsg.text}</div>}
          <OtpBox key={mobile} mobile={mobile} value={otp} onChange={(x) => { setOtp(x); setFaceMsg(null); }} />
          <button type="button" disabled={busy} onClick={confirmOtp}>{busy ? t('Please wait...') : t('Verify and continue')}</button>{' '}
          <button type="button" className="secondary" onClick={rescan}>{t('Scan my face again')}</button>
        </div></div>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <div className="container"><div className="card">
        <h2>{t(title)}</h2>
        <div className="steps"><span className="done">✓ 1. {t('Face registration')}</span><span className="on">2. {t('Your details')}</span></div>
        <p className="muted">{t(intro)}</p>
        <div className="banner ok">{sharedFace ? t('Your face matched the one already registered for this number.') : t('Face registered for {mobile}.', { mobile })}</div>
        {aadhaarFill.length > 0 && <AadhaarFetch onFetched={fill} onNumber={setAadhaar} />}
        {speechInSupported && <button type="button" className="secondary" onClick={guide} style={{ marginBottom: 12 }}>{guided ? `⏹ ${t('Stop voice fill')}` : `🎙️ ${t('Fill this form by voice')}`}</button>}
        {msg && <div className="banner err">{msg}</div>}
        <form onSubmit={submit} noValidate>
          {fields.map((f) => (
            <Field key={f.name} field={f} value={v[f.name]} error={errors[f.name]} disabled={f.name === 'mobile'}
              onChange={(n, val) => set(n, f.digits ? onlyDigits(val, f.digits) : val)} />
          ))}
          {aadhaarLink && (
            <div className={`field ${errors.abha ? 'invalid' : ''}`}><label htmlFor="abha">{t('ABHA number (14 digits, optional)')}</label>
              <input id="abha" inputMode="numeric" autoComplete="off" value={v.abha} onChange={(e) => set('abha', onlyDigits(e.target.value, 14))} />
              {errors.abha && <span className="error-text">{t(errors.abha)}</span>}</div>
          )}
          {steps.certificate && (
            <div className={`field ${errors.certificate ? 'invalid' : ''}`}>
              <label>{t(steps.certificate.label)} *</label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files[0] || null); setMsg(''); }} />
              {errors.certificate && <span className="error-text">{t(errors.certificate)}</span>}
            </div>
          )}
          <div className={`field ${errors.declare ? 'invalid' : ''}`}>
            <label className="check"><input type="checkbox" checked={v.declare} onChange={(e) => set('declare', e.target.checked)} />{t(steps.declaration)}</label>
            {errors.declare && <span className="error-text">{t(errors.declare)}</span>}
          </div>
          <button type="submit" disabled={busy}>{busy ? t('Submitting...') : t(steps.submit)}</button>
        </form>
      </div></div>
    </>
  );
}
