import { NavLink, Navigate, Outlet } from 'react-router-dom';
import TopBar from './TopBar';
import { useLang } from '../i18n';
import { getSession } from '../utils/session';

const tabs = [['add', 'Add record'], ['timeline', 'Timeline'], ['medicines', 'Medicines'], ['uploads', 'My uploads'], ['profile', 'Profile'], ['privacy', 'Privacy']];

export default function PatientShell() {
  const s = getSession();
  const { t } = useLang();
  if (!s || s.role !== 'patient') return <Navigate to="/" replace />;
  return (
    <>
      <TopBar />
      <nav className="pills">
        {tabs.map(([p, l]) => (
          <NavLink key={p} to={`/patient/${p}`} className={({ isActive }) => `pill${isActive ? ' on' : ''}`}>{t(l)}</NavLink>
        ))}
      </nav>
      <div className="container"><Outlet /></div>
    </>
  );
}
