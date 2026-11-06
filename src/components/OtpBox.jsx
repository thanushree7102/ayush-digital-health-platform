import { useEffect, useRef, useState } from 'react';
import { platform } from '../api/client';
import { useLang } from '../i18n';
import { onlyDigits } from '../utils/aadhaar';
import Field from './Field';

// Asks the server for a NEW one-time code for this number (a different code for every person and every request),
// shows where it went, and lets the person type it. The code goes to WhatsApp when the bot is linked and the number
// has WhatsApp; it is always printed in the server terminal; in demo mode it is also shown here (OTP_SHOW=0 hides it).
export default function OtpBox({ mobile, value, onChange }) {
  const { t } = useLang();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await platform.post('/auth/otp/send', { mobile });
      setInfo(r.data); setWait(r.data.resendIn || 30); onChange('');
    } catch (e) {
      const d = e.response?.data;
      setErr(d?.wait && d.wait <= 60 ? t('Please wait {n} seconds before asking for a new OTP.', { n: d.wait }) : d?.message ? t(d.message) : t('Could not reach the server. Retry in a moment.'));
      if (d?.wait) setWait(Math.min(d.wait, 60));
    } finally { setBusy(false); }
  };
  useEffect(() => { if (started.current) return; started.current = true; send(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wait <= 0) return undefined; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id); }, [wait]);

  return (
    <div>
      {err && <div className="banner err">{err}</div>}
      {info && info.via === 'whatsapp' && <div className="banner ok">{t('A new OTP was sent to your WhatsApp (+91 {mobile}).', { mobile })}</div>}
      {info && info.demoOtp && (
        <div className="banner info" style={{ textAlign: 'center' }}>
          <div>{t('Your OTP for +91 {mobile} is', { mobile })}</div>
          <div className="hid" style={{ letterSpacing: 6 }}>{info.demoOtp}</div>
          <small className="muted">{info.via === 'whatsapp' ? t('The same OTP was also sent to your WhatsApp. It is valid for 5 minutes.') : t('Demo mode: a real service would send this by WhatsApp or SMS. It is valid for 5 minutes.')}</small>
        </div>
      )}
      {info && info.via !== 'whatsapp' && !info.demoOtp && <div className="banner info">{t('A new OTP was generated. Check the server terminal.')}</div>}
      <Field field={{ name: 'otp', label: 'Enter the 6-digit OTP', digits: 6, required: true }} value={value} onChange={(n, v) => onChange(onlyDigits(v, 6))} />
      <button type="button" className="linkbtn" disabled={busy || wait > 0} onClick={send}>{wait > 0 ? `${t('Resend OTP')} (${wait}s)` : t('Resend OTP')}</button>
    </div>
  );
}
