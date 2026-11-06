import { useState } from 'react';
import { useLang } from '../i18n';
import { digitsFrom, emailFrom, finishListening, listenAlts, speechInSupported } from '../voice/speech';

// Turn what was said into a value for one field. mode: text | area | digits | email | select
// `heard` is one phrase or the list of guesses from the speech engine: the first guess that fits the field wins.
export function applySpoken(heard, { mode, options = [], digits, current = '' }, t) {
  const list = Array.isArray(heard) ? heard : [heard];
  let lastErr = null;
  for (const said of list) {
    try { return applyOne(said, { mode, options, digits, current }, t); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(t('Could not catch that. Please try again.'));
}
function applyOne(said, { mode, options, digits, current }, t) {
  const v = said.trim().replace(/[.।]+$/, '');
  if (mode === 'email') return emailFrom(v);
  if (mode === 'digits') {
    const d = digitsFrom(said).slice(0, digits || 20);
    if (!d) throw new Error(t('Could not catch the digits. Please say them one by one.'));
    return d;
  }
  if (mode === 'select') {
    const low = v.toLowerCase();
    const o = options.find((x) => { const a = x.toLowerCase(); const b = t(x).toLowerCase(); return low.includes(a) || a.includes(low) || low.includes(b) || b.includes(low); });
    if (!o) throw new Error(t('Heard “{said}”, which is not one of the choices.', { said: v }));
    return o;
  }
  if (mode === 'area') return current ? `${current} ${v}` : v;
  return v;
}

// A small 🎤 button: tap, speak (it waits for you to finish), then edit by typing if needed. Tap again to finish early.
export default function VoiceMic({ onValue, spec }) {
  const { lang, t } = useLang();
  const [on, setOn] = useState(false);
  const [note, setNote] = useState('');
  if (!speechInSupported) return null;
  const go = async () => {
    if (on) { finishListening(); return; } // tap again = "I am done": keep what was heard
    setOn(true); setNote(t('Listening… speak now'));
    try {
      const alts = await listenAlts(lang, { silenceMs: spec.mode === 'digits' ? 3000 : 1800, onInterim: (x) => x && setNote(`🎤 ${x}`) });
      const val = applySpoken(alts, spec, t);
      onValue(val); setNote(t('Heard: “{said}”. You can edit it by typing.', { said: val }));
    } catch (e) { setNote(e.message); } finally { setOn(false); }
  };
  return (
    <>
      <button type="button" className={`vmic${on ? ' on' : ''}`} title={t('Speak instead of typing')} aria-label={t('Speak instead of typing')} onClick={go}>🎤</button>
      {note && <small className="vnote" role="status">{note}</small>}
    </>
  );
}
