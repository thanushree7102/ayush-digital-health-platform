import { useEffect, useState } from 'react';
import { platform } from '../api/client';
import { useLang } from '../i18n';
import { aadhaarError, formatAadhaar, onlyDigits } from '../utils/aadhaar';
import VoiceMic from './VoiceMic';

// DEMO Aadhaar lookup: enter one of the demo numbers and the form fills itself.
// onFetched gets { name, dob, gender, addressLine, city, state, pincode, email, maskedAadhaar }.
export default function AadhaarFetch({ onFetched, onNumber }) {
  const { t } = useLang();
  const [a, setA] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState([]);
  useEffect(() => { platform.get('/aadhaar/demo').then((r) => setDemo(r.data)).catch(() => {}); }, []);

  const set = (v) => { const d = onlyDigits(v); setA(d); onNumber?.(d); setMsg(null); };
  const fetchIt = async () => {
    const e = aadhaarError(a);
    if (e) return setMsg({ ok: false, text: t(e) });
    if (!consent) return setMsg({ ok: false, text: t('Please agree to fetch your details from Aadhaar.') });
    setBusy(true);
    try {
      const r = await platform.post('/aadhaar/fetch', { aadhaar: a, consent: true });
      onFetched(r.data);
      setMsg({ ok: true, text: t('Details fetched for {name}. Please check them.', { name: r.data.name }) });
    } catch (err) { setMsg({ ok: false, text: t(err.response?.data?.message || 'Could not fetch. Please retry.') }); } finally { setBusy(false); }
  };

  return (
    <div className="card inner">
      <h3>{t('Fetch my details from Aadhaar (demo)')}</h3>
      <p className="muted">{t('Demo only: enter a demo Aadhaar number and your name, date of birth, gender and address fill in by themselves. Only the last 4 digits are kept.')}</p>
      <div className="field">
        <label htmlFor="aadhaar-fetch">{t('Aadhaar number (12 digits)')}</label>
        <div className="vwrap">
          <input id="aadhaar-fetch" inputMode="numeric" autoComplete="off" placeholder="1234 5678 9012" maxLength={14} value={formatAadhaar(a)} onChange={(e) => set(e.target.value)} />
          <VoiceMic onValue={set} spec={{ mode: 'digits', digits: 12 }} />
        </div>
      </div>
      {demo.length > 0 && (
        <p className="muted">{t('Try a demo number:')}{' '}
          {demo.map((d) => <button key={d.aadhaar} type="button" className="chip" onClick={() => set(d.aadhaar)}>{formatAadhaar(d.aadhaar)} · {d.name}</button>)}
        </p>
      )}
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{t('I agree to fetch my details from Aadhaar.')}</label>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <button type="button" disabled={busy} onClick={fetchIt}>{busy ? t('Please wait...') : t('Fetch my details')}</button>
    </div>
  );
}
