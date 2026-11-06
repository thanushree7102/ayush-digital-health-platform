import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../i18n';
import { clearSession, getSession } from '../utils/session';
import LangSwitch from './LangSwitch';

export default function TopBar() {
  const nav = useNavigate();
  const { t } = useLang();
  const s = getSession();
  return (
    <header className="topbar">
      <div className="brand"><Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>🌿 {t('AYUSH Health Record')}</Link></div>
      <div className="who">
        <LangSwitch />
        <Link to="/assistant" className="toplink">🗣️ {t('Speak & translate')}</Link>
        {s && (
          <>
            <Link to="/me" className="toplink">{s.name}{s.healthId ? ` · ${s.healthId}` : ''}</Link>
            <button type="button" className="ghost" onClick={() => { clearSession(); nav('/'); }}>{t('Sign out')}</button>
          </>
        )}
      </div>
    </header>
  );
}
