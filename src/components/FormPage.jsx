import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import client from '../api/client';
import Field from './Field';
import useDraft from '../hooks/useDraft';
import { formatIST } from '../utils/time';
import { useLang } from '../i18n';

// Generic form: validation, autosave/resume, save confirmation,
// API failure + retry, access-denied. Reused by every Ayurveda screen.
export default function FormPage({ title, endpoint, fields, requiredRole, prefill }) {
  const { t } = useLang();
  const { id } = useParams();
  const role = localStorage.getItem('role') || 'practitioner';

  const empty = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.name, f.type === 'multiselect' ? [] : ''])),
    [fields]
  );

  const base = useMemo(() => ({ ...empty, ...(prefill || {}) }), [empty, prefill]);
  const hasPrefill = !!prefill && Object.values(prefill).some(Boolean);
  const [values, setValues] = useState(base);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: 'idle' }); // idle | saving | saved | error | denied
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(null); // { values, at }
  const [editing, setEditing] = useState(true);
  const [pendingDraft, setPendingDraft] = useState(null);
  const idemKey = useRef(crypto.randomUUID());

  const draftKey = `draft:${id}:${endpoint}`;
  const { savedAt, load, clear } = useDraft(draftKey, values, dirty);

  // Offer to resume an interrupted draft
  useEffect(() => {
    setValues(base); setSaved(null); setEditing(true); setDirty(false);
    setStatus({ state: 'idle' }); setPendingDraft(load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  if (requiredRole && role !== requiredRole) {
    return (
      <div className="card">
        <h3>{title}</h3>
        <div className="banner err">{t('Access denied: only an authorized {role} can use this form.', { role: requiredRole })}</div>
      </div>
    );
  }

  const change = (name, val) => {
    setValues((v) => ({ ...v, [name]: val }));
    setDirty(true);
    setStatus({ state: 'idle' });
  };

  const validate = () => {
    const errs = {};
    fields.forEach((f) => {
      const v = values[f.name];
      const isEmpty = Array.isArray(v) ? v.length === 0 : !String(v).trim();
      if (f.required && isEmpty) errs[f.name] = `${f.label} is required`;
    });
    return errs;
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setStatus({ state: 'saving' });
    try {
      await client.post(`/consultations/${id}/${endpoint}`, values, {
        headers: { 'Idempotency-Key': idemKey.current }, // safe retries
      });
      clear();
      setDirty(false);
      setSaved({ values, at: new Date().toISOString() });
      setEditing(false);
      idemKey.current = crypto.randomUUID();
      setStatus({ state: 'saved' });
    } catch (err) {
      const code = err.response?.status;
      if (code === 401 || code === 403) setStatus({ state: 'denied' });
      else if (code === 400 || code === 422)
        setStatus({ state: 'error', message: err.response.data?.message || 'Some values are invalid.' });
      else setStatus({ state: 'error', message: 'Could not reach the server. Your data is kept; please retry.', retry: true });
    }
  };

  const resume = () => { setValues({ ...empty, ...pendingDraft.values }); setDirty(true); setPendingDraft(null); };
  const discard = () => { clear(); setPendingDraft(null); };

  return (
    <div className="card">
      <h3>{title}</h3>

      {hasPrefill && editing && !saved && (
        <div className="banner info">Some fields were filled from the patient's prescription. Please review them before saving.</div>
      )}
      {pendingDraft && editing && (
        <div className="banner info">
          {t('Unsaved draft found ({when}).', { when: formatIST(pendingDraft.at) })}{' '}
          <button type="button" onClick={resume}>Resume</button>
          <button type="button" className="secondary" onClick={discard}>Discard</button>
        </div>
      )}
      {status.state === 'denied' && <div className="banner err">Access denied for this action.</div>}
      {status.state === 'error' && (
        <div className="banner err">
          {status.message}{' '}
          {status.retry && <button type="button" onClick={submit}>Retry</button>}
        </div>
      )}
      {status.state === 'saved' && <div className="banner ok">Saved successfully.</div>}

      {!editing && saved ? (
        <>
          <dl className="summary">
            {fields.map((f) => (
              <div key={f.name}>
                <dt>{f.label}</dt>
                <dd>{Array.isArray(saved.values[f.name]) ? saved.values[f.name].join(', ') : saved.values[f.name] || '-'}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">Saved {formatIST(saved.at)}</p>
          {/* Correction = new version, never a delete (NFR-DAT-02) */}
          <button type="button" onClick={() => setEditing(true)}>Edit (save as new version)</button>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          {fields.map((f) => (
            <Field key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={change} />
          ))}
          <button type="submit" disabled={status.state === 'saving'}>
            {status.state === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {savedAt && dirty && <span className="muted"> &nbsp;Draft autosaved {formatIST(savedAt)}</span>}
        </form>
      )}
    </div>
  );
}
