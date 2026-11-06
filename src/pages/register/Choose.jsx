import { Link, useLocation } from 'react-router-dom';
import TopBar from '../../components/TopBar';
import { useLang } from '../../i18n';

const roles = [
  ['/register/patient', '🧑 Patient', 'Create your health record. Add prescriptions and choose which doctors can see them.'],
  ['/register/doctor', '🩺 Doctor / Practitioner', 'Register with your council number and certificate. An admin verifies you before you can open records.'],
  ['/register/clinic', '🏥 Clinic / Hospital', 'Register your facility and licence. Doctors link to your Facility ID.'],
  ['/register/admin', '🛡️ Admin / Auditor', 'Staff only. Needs an invite code. Admins approve registrations; auditors view the log.'],
];

export default function Choose() {
  const { t } = useLang();
  const { state } = useLocation();
  return (
    <>
      <TopBar />
      <div className="container">
        <div className="card"><h2>{t('Create an account')}</h2><p className="muted">{t('Every account type starts with the same face registration, then asks for its own details. Pick yours.')}</p></div>
        <div className="rolegrid">
          {roles.map(([to, title, d]) => (
            <Link key={to} to={to} state={state} className="rolecard"><h3>{t(title)}</h3><p className="muted">{t(d)}</p></Link>
          ))}
        </div>
      </div>
    </>
  );
}
