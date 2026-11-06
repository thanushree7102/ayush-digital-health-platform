import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { platform } from '../../api/client';
import TopBar from '../../components/TopBar';
import { formatHealthId, onlyDigits } from '../../utils/aadhaar';
import { getSession } from '../../utils/session';

export default function FindPatient() {
  const nav = useNavigate();
  const s = getSession();
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s || s.role !== 'practitioner') return <Navigate to="/" replace />;

  const open = async (e) => {
    e.preventDefault();
    if (onlyDigits(id, 14).length !== 14) { setError('Health Record ID must be 14 digits'); return; }
    setBusy(true); setError('');
    try {
      const r = await platform.get(`/patients/${id}/summary`);
      sessionStorage.setItem('activePatient', JSON.stringify({
        name: r.data.name, healthId: r.data.healthId, consultationId: r.data.consultationId, extracted: r.data.lastExtracted || null,
      }));
      nav(`/ayurveda/consultations/${r.data.consultationId}/prakriti-vikriti`);
    } catch (err) {
      const c = err.response?.status;
      setError(c === 403 ? err.response.data?.message || 'The patient has not shared the record with you.'
        : c === 404 ? 'No record found for this ID.' : 'Could not reach the server. Retry in a moment.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <TopBar />
      <div className="container">
        <div className="card">
          <h2>Open a patient record</h2>
          <p className="muted">Enter the patient's Health Record ID. You can open it only if the patient has shared it with you.</p>
          {error && <div className="banner err">{error}</div>}
          <form onSubmit={open} noValidate>
            <div className="field"><label htmlFor="hid">Health Record ID</label>
              <input id="hid" inputMode="numeric" placeholder="91-1234-5678-9012" value={id} onChange={(e) => { setId(formatHealthId(e.target.value)); setError(''); }} /></div>
            <button type="submit" disabled={busy}>{busy ? 'Opening...' : 'Open record'}</button>
          </form>
        </div>
      </div>
    </>
  );
}
