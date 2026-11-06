import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { platform } from '../../api/client';
import TopBar from '../../components/TopBar';
import { getSession } from '../../utils/session';
import { formatIST as toIST } from '../../utils/time';

export default function AdminDashboard() {
  const s = getSession();
  const perms = s?.permissions || [];
  const [pending, setPending] = useState([]);
  const [audit, setAudit] = useState([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([platform.get('/admin/pending'), perms.includes('audit.view') ? platform.get('/admin/audit') : Promise.resolve({ data: [] })]);
      setPending(p.data); setAudit(a.data);
    } catch (e) { setMsg('Could not load. Retry in a moment.'); }
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  if (!s || s.role !== 'admin') return <Navigate to="/" replace />;
  const canDecide = (r) => perms.includes(r.kind === 'practitioner' ? 'doctor.verify' : 'facility.approve');

  const decide = async (row, decision) => {
    let reason;
    if (decision === 'reject' || decision === 'request_info') {
      reason = window.prompt(decision === 'reject' ? 'Why is this being rejected?' : 'What information is needed?');
      if (!reason || !reason.trim()) return;
    }
    try { await platform.post('/admin/decisions', { kind: row.kind, id: row.id, decision, reason }); setMsg(''); load(); }
    catch (e) { setMsg(e.response?.data?.message || 'Could not save the decision.'); }
  };

  const openDoc = async (row) => {
    try {
      const r = await platform.get(`/admin/documents/${row.kind}/${row.id}`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data), '_blank', 'noopener');
    } catch (e) { setMsg('Could not open the document.'); }
  };

  return (
    <><TopBar /><div className="container">
      <div className="card"><h2>{s.adminType} dashboard</h2>
        {!perms.some((p) => ['doctor.verify', 'facility.approve'].includes(p)) && <div className="banner info">Your role can view but cannot approve or reject.</div>}
        {msg && <div className="banner err">{msg}</div>}
        <h3>Verification queue</h3>
        <table className="tbl"><thead><tr><th>Type</th><th>Name</th><th>Details</th><th>Status</th><th></th></tr></thead>
          <tbody>{pending.map((r) => (
            <tr key={r.caseId}><td>{r.kind}</td><td>{r.name}<br /><span className="muted">{r.id}</span></td><td>{r.detail}</td><td><span className="badge">{r.status}</span></td>
              <td>
                {r.hasDocument && perms.includes('document.view') && <><button type="button" className="secondary" onClick={() => openDoc(r)}>View document</button>{' '}</>}
                {canDecide(r) && (
                  <>
                    {r.status === 'Pending' && <><button type="button" className="secondary" onClick={() => decide(r, 'start_review')}>Start review</button>{' '}</>}
                    <button type="button" onClick={() => decide(r, 'approve')}>Approve</button>{' '}
                    <button type="button" className="secondary" onClick={() => decide(r, 'request_info')}>Need info</button>{' '}
                    <button type="button" className="secondary" onClick={() => decide(r, 'reject')}>Reject</button>
                  </>
                )}
              </td></tr>))}
            {!pending.length && <tr><td colSpan={5} className="muted">Nothing waiting.</td></tr>}</tbody></table>
      </div>
      {perms.includes('audit.view') && (
        <div className="card"><h3>Audit log</h3>
          <table className="tbl"><thead><tr><th>When (IST)</th><th>By</th><th>Action</th><th>Target</th><th>Result</th><th>Reason</th></tr></thead>
            <tbody>{audit.map((a, i) => <tr key={i}><td>{toIST(a.at)}</td><td>{a.by}</td><td>{a.action}</td><td>{a.kind}{a.targetId ? <><br /><span className="muted">{a.targetId}</span></> : null}</td><td>{a.result}</td><td>{a.reason}</td></tr>)}
              {!audit.length && <tr><td colSpan={6} className="muted">Nothing logged yet.</td></tr>}</tbody></table>
        </div>
      )}
    </div></>
  );
}
