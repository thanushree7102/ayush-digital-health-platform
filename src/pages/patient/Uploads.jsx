import useSummary from '../../hooks/useSummary';
import { getSession } from '../../utils/session';
import { formatIST } from '../../utils/time';

export default function Uploads() {
  const s = useSummary(getSession().healthId);
  if (s.loading) return <div className="card"><p>Loading...</p></div>;
  if (s.error) return <div className="card"><div className="banner err">{s.error} {s.retry && <button type="button" onClick={s.reload}>Retry</button>}</div></div>;
  const ups = [...s.data.uploads].reverse();
  return (
    <div className="card">
      <h3>My uploads</h3>
      {ups.length === 0 ? <p className="muted">Nothing uploaded yet.</p> : (
        <table className="tbl"><thead><tr><th>File</th><th>Type</th><th>Added</th></tr></thead>
          <tbody>{ups.map((u, i) => <tr key={i}><td>{u.fileName}</td><td>{u.documentType}</td><td>{formatIST(u.savedAt)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
