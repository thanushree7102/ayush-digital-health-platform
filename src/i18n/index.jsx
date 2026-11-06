import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DICT } from './dict';
import { applyDomLang } from './domTranslate';

// The three supported languages: [code, name shown on the button, speech-recognition / speech-synthesis locale]
export const LANGS = [['en', 'English', 'en-IN'], ['hi', 'हिन्दी', 'hi-IN'], ['kn', 'ಕನ್ನಡ', 'kn-IN']];
export const localeOf = (l) => (LANGS.find((x) => x[0] === l) || LANGS[0])[2];

const stored = () => { try { const l = localStorage.getItem('lang'); return LANGS.some((x) => x[0] === l) ? l : 'en'; } catch (e) { return 'en'; } };
let current = stored();

// tr('English text') -> the text in the chosen language (falls back to English). {name} placeholders are filled from vars.
export const tr = (s, vars) => {
  let out = (DICT[current] && DICT[current][s]) || s;
  if (vars) Object.entries(vars).forEach(([k, v]) => { out = out.split(`{${k}}`).join(v); });
  return out;
};
export const currentLang = () => current;

const Ctx = createContext({ lang: 'en', setLang: () => {}, t: tr });
export function LangProvider({ children }) {
  const [lang, setL] = useState(current);
  const value = useMemo(() => ({
    lang,
    t: tr,
    setLang: (l) => {
      current = l;
      try { localStorage.setItem('lang', l); } catch (e) { /* private mode */ }
      document.documentElement.lang = l;
      setL(l);
    },
  }), [lang]);
  document.documentElement.lang = lang;
  useEffect(() => { applyDomLang(lang); }, [lang]); // translate everything on screen, including text not wrapped in t()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);
