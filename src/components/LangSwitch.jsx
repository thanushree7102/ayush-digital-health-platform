import { LANGS, useLang } from '../i18n';

export default function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="langsw" role="group" aria-label="Language">
      {LANGS.map(([k, name]) => <button key={k} type="button" className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{name}</button>)}
    </div>
  );
}
