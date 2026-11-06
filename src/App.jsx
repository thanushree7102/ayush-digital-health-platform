import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import TopBar from './components/TopBar';
import PatientShell from './components/PatientShell';
import CommonClinical from './components/CommonClinical';
import Landing from './pages/Landing';
import Me from './pages/Me';
import Assistant from './pages/Assistant';
import AddRecord from './pages/patient/AddRecord';
import Timeline from './pages/patient/Timeline';
import Medicines from './pages/patient/Medicines';
import Uploads from './pages/patient/Uploads';
import Privacy from './pages/patient/Privacy';
import Profile from './pages/patient/Profile';
import FindPatient from './pages/doctor/FindPatient';
import PrakritiVikriti from './pages/PrakritiVikriti';
import Dashavidha from './pages/Dashavidha';
import Examination from './pages/Examination';
import Comparison from './pages/Comparison';
import Diagnosis from './pages/Diagnosis';
import Therapy from './pages/Therapy';
import Choose from './pages/register/Choose';
import RegPatient from './pages/register/Patient';
import RegDoctor from './pages/register/Doctor';
import RegClinic from './pages/register/Clinic';
import RegAdmin from './pages/register/Admin';
import ClinicDashboard from './pages/clinic/Dashboard';
import AdminDashboard from './pages/admin/Dashboard';
import { getActivePatient, getSession } from './utils/session';

function DoctorLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = getSession();
  const patient = getActivePatient();
  if (!s || s.role !== 'practitioner' || !patient) return <Navigate to="/doctor" replace />;
  const base = `/ayurveda/consultations/${id}`;

  return (
    <>
      <TopBar />
      <div className="layout">
        <aside className="sidebar">
          <h2>Ayurveda</h2>
          <NavLink to={`${base}/common-clinical`}>Common clinical</NavLink>
          <NavLink to={`${base}/prakriti-vikriti`}>1. Prakriti &amp; Vikriti</NavLink>
          <NavLink to={`${base}/dashavidha-pariksha`}>2. Dashavidha Pariksha</NavLink>
          <NavLink to={`${base}/examination`}>3. Agni / Koshtha</NavLink>
          <NavLink to={`${base}/comparison`}>4. Comparison</NavLink>
          <NavLink to={`${base}/diagnosis`}>5. Diagnosis</NavLink>
          <NavLink to={`${base}/therapy`}>6. Therapy &amp; Advice</NavLink>
        </aside>
        <main className="main">
          <div className="header">
            <div><strong>Patient:</strong> {patient.name} ({patient.healthId}) &nbsp;|&nbsp; <strong>Consultation:</strong> {id}</div>
            <button type="button" className="secondary" onClick={() => nav('/doctor')}>Change patient</button>
          </div>
          <Routes>
            <Route path="common-clinical" element={<CommonClinical healthId={patient.healthId} view="all" />} />
            <Route path="prakriti-vikriti" element={<PrakritiVikriti />} />
            <Route path="dashavidha-pariksha" element={<Dashavidha />} />
            <Route path="examination" element={<Examination />} />
            <Route path="comparison" element={<Comparison />} />
            <Route path="diagnosis" element={<Diagnosis />} />
            <Route path="therapy" element={<Therapy />} />
            <Route path="*" element={<Navigate to="prakriti-vikriti" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Choose />} />
      <Route path="/register/patient" element={<RegPatient />} />
      <Route path="/register/doctor" element={<RegDoctor />} />
      <Route path="/register/clinic" element={<RegClinic />} />
      <Route path="/register/admin" element={<RegAdmin />} />
      <Route path="/me" element={<Me />} />
      <Route path="/assistant" element={<Assistant />} />
      <Route path="/clinic" element={<ClinicDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/patient" element={<PatientShell />}>
        <Route index element={<Navigate to="add" replace />} />
        <Route path="add" element={<AddRecord />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="medicines" element={<Medicines />} />
        <Route path="uploads" element={<Uploads />} />
        <Route path="profile" element={<Profile />} />
        <Route path="privacy" element={<Privacy />} />
      </Route>
      <Route path="/doctor" element={<FindPatient />} />
      <Route path="/ayurveda/consultations/:id/*" element={<DoctorLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
