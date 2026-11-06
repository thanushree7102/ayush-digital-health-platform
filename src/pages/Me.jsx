import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { platform } from '../api/client';
import TopBar from '../components/TopBar';
import { useLang } from '../i18n';
import { hasVoiceFor, speak, speechOutSupported } from '../voice/speech';
import { getSession } from '../utils/session';

const HOME = { patient: '/patient/profile', practitioner: '/doctor', facility: '/clinic', admin: '/admin' };

// "My details": everything stored for the signed-in person, fetched with the token from the face (or OTP) sign-in. Works for every role.
export default function Me() {
  const { t, lang } = useLang();
  const s = getSession();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState('');
  const stop = useRef(false);
  useEffect(() => {
    if (!s) return;
    platform.get('/me').then((r) => setD(r.data)).catch((e) => setErr(t(e.response?.data?.message || 'Could not load your details.')));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stop.current = true; if (speechOutSupported) speechSynthesis.cancel(); }, []);
  // ONE voice button: reads all the stored details aloud in the chosen language (numbers digit by digit)
  const readAloud = async () => {
    if (reading) { stop.current = true; speechSynthesis.cancel(); setReading(false); return; }
    const spell = (x) => (/^[\d\s-]{6,}$/.test(String(x)) ? String(x).replace(/\D/g, '').split('').join(' ') : String(x));
    const lines = [`${t('My details')}.`, `${d.name}.`, `${t(d.codeLabel)}: ${spell(d.code)}.`, `${t('Mobile number')}: ${spell(d.mobile)}.`,
      ...Object.entries(d.details).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${t(k)}: ${spell(v)}.`)];
    setNote(hasVoiceFor(lang) ? '' : t('This device has no voice for this language. Try Chrome or Edge, or install the language voice.'));
    stop.current = false; setReading(true);
    for (const l of lines) { if (stop.current) break; await speak(l, lang); }
    setReading(false);
  };
  if (!s) return <Navigate to="/" replace />;
  return (
    <>
      <TopBar />
      <div className="container">
        <div className="card">
          <h2>{t('My details')}</h2>
          {err && <div className="banner err">{err}</div>}
          {!d && !err && <p className="muted">{t('Loading…')}</p>}
          {d && (
            <>
              <div className="hid">{d.code}</div>
              <p className="muted">{t(d.codeLabel)} · {d.name} · {t(({ patient: 'Patient', practitioner: 'Doctor', facility: 'Clinic / Hospital', admin: 'Admin / Auditor' })[d.role])}</p>
              <dl className="summary">
                <dt>{t('Mobile number')}</dt><dd>{d.mobile}</dd>
                {Object.entries(d.details).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (<span key={k}><dt>{t(k)}</dt><dd>{String(v)}</dd></span>))}
                <dt>{t('Face sign-in')}</dt><dd>{d.faceRegistered ? `✓ ${t('Registered')}` : t('Not set up')}</dd>
              </dl>
              {speechOutSupported && <><button type="button" className="secondary" onClick={readAloud}>{reading ? `⏹ ${t('Stop reading')}` : `🔊 ${t('Read my details aloud')}`}</button>{' '}</>}
              <button type="button" onClick={() => nav(HOME[d.role])}>{t('Open my workspace')}</button>
              {d.role === 'patient' && <>{' '}<Link to="/patient/profile"><button type="button" className="secondary">{t('Add medical history')}</button></Link></>}
              {note && <p className="muted">{note}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
