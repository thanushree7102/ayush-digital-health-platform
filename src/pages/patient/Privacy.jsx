import { useEffect, useState } from 'react';
import { platform } from '../../api/client';
import { getSession } from '../../utils/session';

// Selective sharing: only the doctors the patient ticks can open the record.
export default function Privacy() {
  const s = getSession();
  const [doctors, setDoctors] = useState([]);
  const [selected, setSelected] = useState([]);
  const [status, setStatus] = useState({ state: 'loading' });

  useEffect(() => {
    Promise.all([platform.get('/doctors'), platform.get(`/patients/${s.healthId}/summary`)])
      .then(([d, p]) => { setDoctors(d.data); setSelected(p.data.sharedWith || []); setStatus({ state: 'idle' }); })
      .catch(() => setStatus({ state: 'error', message: 'Could not load your sharing settings.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id) => { setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setStatus({ state: 'idle' }); };
  const save = async () => {
    setStatus({ state: 'saving' });
    try { await platform.post(`/patients/${s.healthId}/consents`, { doctorIds: selected }); setStatus({ state: 'saved' }); }
    catch (e) { setStatus({ state: 'error', message: 'Could not save. Please retry.' }); }
  };

  return (
    <div className="card">
      <h3>Who can see my record</h3>
      <p className="muted">Only the doctors you select can open your record. You can change this at any time.</p>
      {status.state === 'error' && <div className="banner err">{status.message}</div>}
      {status.state === 'saved' && <div className="banner ok">Sharing settings saved.</div>}
      {doctors.map((d) => (
        <label className="check row" key={d.id}>
          <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
          <span>{d.name} <span className="muted">· {d.system}</span></span>
        </label>
      ))}
      <button type="button" onClick={save} disabled={status.state === 'saving' || status.state === 'loading'}>Save</button>
    </div>
  );
}
