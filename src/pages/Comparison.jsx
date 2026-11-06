import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import client from '../api/client';

// Read-only view: shows what the backend returns. Does not create a diagnosis.
export default function Comparison() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true });

  const load = () => {
    setState({ loading: true });
    client.get(`/consultations/${id}/prakriti-vikriti`)
      .then((r) => setState({ data: r.data }))
      .catch((err) => {
        const code = err.response?.status;
        if (code === 401 || code === 403) setState({ denied: true });
        else if (code === 404) setState({ error: err.response.data?.message || 'Record Prakriti and Vikriti first.' });
        else setState({ error: 'Could not load comparison.', retry: true });
      });
  };
  useEffect(load, [id]);

  return (
    <div className="card">
      <h3>Prakriti vs Vikriti</h3>
      {state.loading && <p>Loading...</p>}
      {state.denied && <div className="banner err">Access denied.</div>}
      {state.error && (
        <div className="banner err">{state.error} {state.retry && <button onClick={load}>Retry</button>}</div>
      )}
      {state.data && (
        <>
          <div className="compare">
            <div className="box"><h4>Prakriti (baseline)</h4>{state.data.prakriti}</div>
            <div className="box"><h4>Vikriti (current)</h4>{state.data.vikriti}</div>
          </div>
          <h4>Differences</h4>
          {state.data.differences?.length ? (
            <ul>{state.data.differences.map((d) => <li key={d}>{d}</li>)}</ul>
          ) : <p>No differences found.</p>}
          <p className="muted">For practitioner reference only. The diagnosis is entered by the practitioner.</p>
        </>
      )}
    </div>
  );
}
