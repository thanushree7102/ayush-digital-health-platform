import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { platform } from '../api/client';
import FaceCapture, { warmFace } from '../components/FaceCapture';
import Field from '../components/Field';
import OtpBox from '../components/OtpBox';
import TopBar from '../components/TopBar';
import { useLang } from '../i18n';
import { onlyDigits } from '../utils/aadhaar';
import { setSession } from '../utils/session';

const ROLES = [['patient', 'Patient'], ['practitioner', 'Doctor'], ['facility', 'Clinic / Hospital'], ['admin', 'Admin / Auditor']];
const HOME = { patient: '/patient/add', practitioner: '/doctor', facility: '/clinic', admin: '/admin' };
const HINT = {
  patient: 'Patients: create your record first.',
  practitioner: 'Demo doctor: 9000000001 (a new OTP is shown after you continue)',
  facility: 'Demo clinic: 9000000005 (a new OTP is shown after you continue)',
  admin: 'Demo admin: 9000000009 · auditor: 9000000008 (a new OTP is shown after you continue)',
};

// Start screen for everyone: 1) mobile number  2) face scan  3) a NEW one-time code sent to that number  ->  signed in, details fetched.
// (Without a camera / registered face: the one-time code alone.)
export default function Landing() {
  const nav = useNavigate();
  const { t } = useLang();
  const [role, setRole] = useState('patient');
  const [mobile, setMobile] = useState('');
  const [info, setInfo] = useState(null); // { faceRegistered, accounts }
  const [useOtp, setUseOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [faceToken, setFaceToken] = useState(''); // set after the face matched; the OTP step comes next
  const [addFace, setAddFace] = useState(null); // after an OTP sign-in without a face
  const [msg, setMsg] = useState('');
  useEffect(() => { const id = setTimeout(warmFace, 600); return () => clearTimeout(id); }, []); // load the face models while the person types the number
  const [wa, setWa] = useState(null); // WhatsApp bot QR (only when the bot's number is known)
  useEffect(() => { platform.get('/whatsapp/qr').then((r) => setWa(r.data?.enabled ? r.data : null)).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);

  const fail = (err) => { const c = err.response?.status; setMsg(c && c < 500 ? t(err.response.data?.message || 'Please check the details.') : t('Could not reach the server. Retry in a moment.')); };
  const reset = () => { setInfo(null); setUseOtp(false); setOtp(''); setFaceToken(''); setMsg(''); setAddFace(null); };

  const next = async (ev) => {
    ev.preventDefault();
    if (!/^[6-9]\d{9}$/.test(mobile)) return setMsg(t('Enter a valid 10-digit mobile number'));
    setBusy(true); setMsg('');
    try {
      const r = await platform.post('/face/status', { mobile });
      setInfo(r.data); setUseOtp(!r.data.faceRegistered);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const enter = (data, tokenless) => { setSession({ ...data, mobile }); nav(HOME[data.role]); return tokenless; };

  const faceLogin = async (cap) => {
    setMsg('');
    try {
      const v = await platform.post('/face/verify', { mobile, descriptor: cap.descriptor, liveness: true });
      setFaceToken(v.data.faceToken); setOtp(''); // face matched -> now a fresh OTP is sent to this number
    } catch (err) { fail(err); }
  };

  const otpLogin = async (ev) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setMsg(t('Enter the 6-digit OTP'));
    setBusy(true); setMsg('');
    try {
      const l = await platform.post('/auth/login', { mobile, otp, role, ...(faceToken ? { faceToken } : {}) });
      if (!l.data.faceRegistered) setAddFace(l.data); else enter(l.data);
    } catch (err) {
      if (err.response?.data?.message?.includes('face check expired')) setFaceToken('');
      fail(err);
    } finally { setBusy(false); }
  };

  const enrolAfterOtp = async (cap) => {
    try { await platform.post('/face/enroll', { mobile, otp, descriptor: cap.descriptor, liveness: true, consent: true }); enter({ ...addFace, faceRegistered: true }); } catch (err) { fail(err); }
  };

  const hasAccount = info && info.accounts.includes(role);

  return (
    <><TopBar /><div className="container"><div className="card">
      <h2>{t('Your AYUSH health history, in one place')}</h2>
      <p className="muted">{t('Ayurveda, Yoga & Naturopathy, Unani, Siddha and Homoeopathy.')}</p>
      <div className="field"><label>{t('Sign in as')}</label>
        <div className="seg">{ROLES.map(([k, l]) => (
          <button key={k} type="button" className={role === k ? 'on' : ''} onClick={() => { setRole(k); setMsg(''); setAddFace(null); }}>{t(l)}</button>))}</div></div>
      {msg && <div className="banner err">{msg}</div>}

      {!info && (
        <form onSubmit={next} noValidate>
          <Field field={{ name: 'mobile', label: 'Mobile number', digits: 10 }} value={mobile} onChange={(n, v) => { setMobile(onlyDigits(v, 10)); setMsg(''); }} />
          <button type="submit" disabled={busy}>{busy ? t('Please wait...') : t('Continue')}</button>
        </form>
      )}

      {info && !hasAccount && (
        <div>
          <div className="banner info">{t('No {role} account for {mobile} yet.', { role: t(ROLES.find((r) => r[0] === role)[1]), mobile })}</div>
          <button type="button" onClick={() => nav(`/register/${{ patient: 'patient', practitioner: 'doctor', facility: 'clinic', admin: 'admin' }[role]}`, { state: { mobile } })}>{t('Create an account')}</button>{' '}
          <button type="button" className="secondary" onClick={reset}>{t('Use another number')}</button>
        </div>
      )}

      {info && hasAccount && addFace && (
        <div>
          <div className="banner ok">{t('Signed in. Add your face so next time you can sign in with just a scan.')}</div>
          <FaceCapture buttonLabel={`📷 ${t('Add my face')}`} onCaptured={enrolAfterOtp} />
          <button type="button" className="secondary" onClick={() => enter(addFace)}>{t('Skip for now')}</button>
        </div>
      )}

      {info && hasAccount && !addFace && !useOtp && !faceToken && (
        <div>
          <p>{t('Mobile number')}: <strong>{mobile}</strong> <button type="button" className="linkbtn" onClick={reset}>{t('Change')}</button></p>
          <FaceCapture buttonLabel={`📷 ${t('Scan my face')}`} onCaptured={faceLogin} />
          <button type="button" className="linkbtn" onClick={() => { setUseOtp(true); setMsg(''); }}>{t('Use OTP instead')}</button>
        </div>
      )}

      {info && hasAccount && !addFace && (useOtp || faceToken) && (
        <form onSubmit={otpLogin} noValidate>
          <p>{t('Mobile number')}: <strong>{mobile}</strong> <button type="button" className="linkbtn" onClick={reset}>{t('Change')}</button></p>
          {faceToken && <div className="banner ok">{t('Face matched. Now enter the OTP we just sent to this number.')}</div>}
          <OtpBox key={`${mobile}-${faceToken ? 'face' : 'otp'}`} mobile={mobile} value={otp} onChange={(v) => { setOtp(v); setMsg(''); }} />
          <button type="submit" disabled={busy}>{busy ? t('Please wait...') : t('Sign in')}</button>{' '}
          {info.faceRegistered && <button type="button" className="secondary" onClick={() => { setUseOtp(false); setFaceToken(''); setOtp(''); setMsg(''); }}>{faceToken ? t('Scan my face again') : t('Use my face instead')}</button>}
        </form>
      )}

      <p className="muted" style={{ marginTop: 14 }}>{t(HINT[role])}</p>
      <p>{t('New here?')} <Link to="/register">{t('Create an account')}</Link></p>
      {wa && role === 'patient' && (
        <div className="banner info" style={{ textAlign: 'center' }}>
          <strong>{t('Prefer WhatsApp?')}</strong>
          <p className="muted">{t('Scan with your phone camera to open our WhatsApp chat. Say Hi, agree to register, and your record is also here on the website.')}</p>
          <img src={wa.qr} alt="WhatsApp QR" width="180" height="180" />
          <div><a href={wa.link} target="_blank" rel="noreferrer">{wa.number}</a></div>
        </div>
      )}
    </div></div></>
  );
}
