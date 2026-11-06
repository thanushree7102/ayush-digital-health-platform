import useSummary from '../hooks/useSummary';
import { formatIST } from '../utils/time';

// Shared clinical history (timeline + medicines) used by both patient and doctor.
export default function CommonClinical({ healthId, view = 'all' }) {
  const s = useSummary(healthId);
  if (s.loading) return <div className="card"><p>Loading...</p></div>;
  if (s.error) {
    return (
      <div className="card"><div className="banner err">{s.error} {s.retry && <button type="button" onClick={s.reload}>Retry</button>}</div></div>
    );
  }
  const records = [...s.data.records].reverse();
  const meds = records.flatMap((r) => (r.medicines || []).filter((m) => m.name).map((m) => ({ ...m, system: r.system, savedAt: r.savedAt })));

  return (
    <>
      {view === 'all' && (s.data.medicalHistory?.length > 0 || s.data.concerns?.length > 0) && (
        <div className="card">
          <h3>Medical history and concerns</h3>
          {s.data.medicalHistory.map((h, i) => (
            <div className="tl" key={`h${i}`}>
              {h.conditionName && <div><strong>Condition:</strong> {h.conditionName}</div>}
              {h.allergies && <div><strong>Allergies:</strong> {h.allergies}</div>}
              {h.currentMedications && <div><strong>Current medicines:</strong> {h.currentMedications}</div>}
              {h.chronicConditions && <div><strong>Chronic:</strong> {h.chronicConditions}</div>}
              {h.pastSurgeries && <div><strong>Surgeries:</strong> {h.pastSurgeries}</div>}
              {h.familyHistory && <div><strong>Family history:</strong> {h.familyHistory}</div>}
              {h.previousTreatments && <div><strong>Previous treatments:</strong> {h.previousTreatments}</div>}
            </div>
          ))}
          {s.data.concerns.map((c, i) => <div className="tl" key={`c${i}`}><strong>Concern:</strong> {c.symptoms}{c.duration ? ` (${c.duration})` : ''}</div>)}
        </div>
      )}
      {(view === 'all' || view === 'timeline') && (
        <div className="card">
          <h3>Timeline</h3>
          {records.length === 0 && <p className="muted">No records yet. Add a prescription to start the history.</p>}
          {records.map((r) => (
            <div className="tl" key={r.recordId}>
              <div className="tl-head"><span className="badge">{r.system}</span> <span className="muted">{r.documentType} · {formatIST(r.savedAt)}</span></div>
              {r.problem && <div><strong>Problem:</strong> {r.problem}</div>}
              {r.diagnosis && <div><strong>Diagnosis:</strong> {r.diagnosis}</div>}
              {r.prakriti && <div><strong>Prakriti:</strong> {r.prakriti}</div>}
              {r.medicines?.some((m) => m.name) && <div><strong>Medicines:</strong> {r.medicines.filter((m) => m.name).map((m) => m.name).join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
      {(view === 'all' || view === 'medicines') && (
        <div className="card">
          <h3>Medicines</h3>
          {meds.length === 0 ? <p className="muted">No medicines recorded yet.</p> : (
            <table className="tbl">
              <thead><tr><th>Medicine</th><th>Dose</th><th>When</th><th>For</th><th>System</th></tr></thead>
              <tbody>{meds.map((m, i) => (
                <tr key={i}><td>{m.name}</td><td>{m.dose}</td><td>{m.timing}</td><td>{m.duration}</td><td>{m.system}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
