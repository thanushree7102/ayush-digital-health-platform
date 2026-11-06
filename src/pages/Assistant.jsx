import { useState } from 'react';
import { platform } from '../api/client';
import TopBar from '../components/TopBar';
import { LANGS, useLang } from '../i18n';
import { listen, speak, speechInSupported } from '../voice/speech';

// Language assistant: speak or type in one language, read / hear it in another (English, Hindi, Kannada).
export default function Assistant() {
  const { t, lang } = useLang();
  const [src, setSrc] = useState(lang);
  const [tgt, setTgt] = useState(lang === 'en' ? 'kn' : 'en');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [note, setNote] = useState('');

  const run = (f) => async () => { try { setNote(''); await f(); } catch (e) { setNote(e.message || String(e)); } };
  const translate = async (q) => {
    if (src === tgt) return q;
    setNote(t('Translating…'));
    const r = await platform.post('/translate', { text: q, source: src, target: tgt }).catch((e) => { throw new Error(t(e.response?.data?.message || 'Translation is not available right now.')); });
    setNote(''); return r.data.translated;
  };
  const say = async (txt, l) => { if (!(await speak(txt, l))) setNote(t('No installed voice for this language. Install one in your device settings.')); };

  return (
    <>
      <TopBar />
      <div className="container"><div className="card">
        <h2>🗣️ {t('Speak & translate')}</h2>
        <p className="muted">{t('Talk to a doctor or patient in another language. Speak or type, translate, and listen.')}</p>
        <div className="row2">
          <div className="field"><label>{t('I speak')}</label><select value={src} onChange={(e) => setSrc(e.target.value)}>{LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          <div className="field"><label>{t('Translate to')}</label><select value={tgt} onChange={(e) => setTgt(e.target.value)}>{LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        </div>
        <div className="field"><label>{t('Your words')}</label><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <p>
          {speechInSupported && <button type="button" onClick={run(async () => { setNote(t('Listening… speak now')); setText(await listen(src)); setNote(''); })}>🎤 {t('Speak')}</button>}{' '}
          <button type="button" onClick={run(async () => setOut(await translate(text)))}>{t('Translate')}</button>{' '}
          {speechInSupported && <button type="button" onClick={run(async () => { setNote(t('Listening… speak now')); const said = await listen(src); setText(said); const o = await translate(said); setOut(o); await say(o, tgt); })}>🎤→🔊 {t('Speak, translate and read aloud')}</button>}
        </p>
        <div className="field"><label>{t('Translation')}</label><textarea rows={3} value={out} readOnly /></div>
        <button type="button" className="secondary" onClick={run(async () => say(out || text, out ? tgt : src))}>🔊 {t('Read aloud')}</button>
        {note && <p className="muted" role="status">{note}</p>}
      </div></div>
    </>
  );
}
