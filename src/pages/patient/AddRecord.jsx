import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { platform } from '../../api/client';
import { PRAKRITI_OPTIONS } from '../../constants/options';
import { getSession } from '../../utils/session';

const TYPES = ["Doctor's prescription", 'Medicine photo', 'Lab report'];
const SYSTEMS = ['Ayurveda', 'Yoga & Naturopathy', 'Unani', 'Siddha', 'Homoeopathy'];
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_MB = 5;
const blankMed = { name: '', dose: '', timing: '', duration: '' };

export default function AddRecord() {
  const nav = useNavigate();
  const s = getSession();
  const [stage, setStage] = useState('pick'); // pick | review | saved
  const [type, setType] = useState(TYPES[0]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const u = URL.createObjectURL(file);
      setPreview(u);
      return () => URL.revokeObjectURL(u);
    }
    setPreview('');
    return undefined;
  }, [file]);

  const pick = (f) => {
    if (!f) return;
    if (!ALLOWED.includes(f.type)) { setError('Only JPG, PNG or PDF files are allowed.'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`File is larger than ${MAX_MB} MB.`); return; }
    setError(''); setFile(f);
  };

  const readIt = async () => {
    if (!file) { setError('Choose a photo or file first.'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', type);
      const r = await platform.post('/records/extract', fd, { timeout: 90000 });
      const d = r.data;
      setDraft({
        system: d.system || 'Ayurveda', problem: d.problem || '', diagnosis: d.diagnosis || '', prakriti: d.prakriti || '',
        medicines: d.medicines?.length ? d.medicines : [{ ...blankMed }], advice: d.advice || '',
        readWithAi: !!d.readWithAi, note: d.note || '',
      });
      setStage('review');
    } catch (err) {
      setError('Could not read the file. Try again or use a clearer photo.');
    } finally { setBusy(false); }
  };

  const setD = (k, v) => setDraft((p) => ({ ...p, [k]: v }));
  const setMed = (i, k, v) => setDraft((p) => ({ ...p, medicines: p.medicines.map((m, n) => (n === i ? { ...m, [k]: v } : m)) }));

  const save = async () => {
    const hasMed = draft.medicines.some((m) => m.name.trim());
    if (!draft.problem.trim() && !draft.diagnosis.trim() && !hasMed) {
      setError('Nothing was found in the file. Add at least a problem or a medicine, or try a clearer photo.');
      return;
    }
    setBusy(true); setError('');
    try {
      const { note, readWithAi, ...rest } = draft;
      await platform.post('/records', { healthId: s.healthId, documentType: type, fileName: file.name, ...rest, medicines: draft.medicines.filter((m) => m.name.trim()) });
      setStage('saved');
    } catch (err) {
      setError('Could not save. Your details are kept, please retry.');
    } finally { setBusy(false); }
  };

  const again = () => { setStage('pick'); setFile(null); setDraft(null); setError(''); };

  if (stage === 'saved') {
    return (
      <div className="card center">
        <h2>Saved to your record</h2>
        <p className="muted">Your doctors (the ones you chose in Privacy) can now see it in your timeline.</p>
        <button type="button" onClick={() => nav('/patient/timeline')}>View timeline</button>{' '}
        <button type="button" className="secondary" onClick={again}>Add another</button>
      </div>
    );
  }

  if (stage === 'review') {
    return (
      <div className="card">
        <h2>Check what we found</h2>
        <p className="muted">This is a draft read from your document. Fix anything that is wrong, then save.</p>
        {preview ? <img className="rxprev" src={preview} alt="Your uploaded document" /> : <p className="muted">File: {file.name}</p>}
        {!draft.readWithAi && <div className="banner info">{draft.note || 'Read without AI. Handwriting is read better with the AI reader switched on.'}</div>}
        {error && <div className="banner err">{error}</div>}

        <div className="field"><label>Which AYUSH system is this from?</label>
          <select value={draft.system} onChange={(e) => setD('system', e.target.value)}>{SYSTEMS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label>Problem</label><textarea rows={2} value={draft.problem} onChange={(e) => setD('problem', e.target.value)} /></div>
        <div className="field"><label>Diagnosis</label><input value={draft.diagnosis} onChange={(e) => setD('diagnosis', e.target.value)} /></div>
        <div className="field"><label>Prakriti</label>
          <select value={draft.prakriti} onChange={(e) => setD('prakriti', e.target.value)}><option value="">Not mentioned</option>{PRAKRITI_OPTIONS.map((x) => <option key={x}>{x}</option>)}</select></div>

        <label className="lbl">Medicines</label>
        {draft.medicines.map((m, i) => (
          <div className="medrow" key={i}>
            <input placeholder="Medicine" value={m.name} onChange={(e) => setMed(i, 'name', e.target.value)} />
            <input placeholder="Dose" value={m.dose} onChange={(e) => setMed(i, 'dose', e.target.value)} />
            <input placeholder="When" value={m.timing} onChange={(e) => setMed(i, 'timing', e.target.value)} />
            <input placeholder="For how long" value={m.duration} onChange={(e) => setMed(i, 'duration', e.target.value)} />
            <button type="button" className="secondary" onClick={() => setD('medicines', draft.medicines.filter((_, n) => n !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setD('medicines', [...draft.medicines, { ...blankMed }])}>Add medicine</button>

        <div className="field" style={{ marginTop: 14 }}><label>Advice</label><textarea rows={2} value={draft.advice} onChange={(e) => setD('advice', e.target.value)} /></div>
        <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save to my record'}</button>{' '}
        <button type="button" className="secondary" onClick={again}>Start again</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Add a prescription, medicine photo or report</h2>
      <p className="muted">We read the photo for you, you check it, and it is filed into the right AYUSH record. Nothing is saved until you confirm.</p>
      {error && <div className="banner err">{error}</div>}
      <div className="field"><label>What are you adding?</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></div>

      <label className="dropzone" htmlFor="rx" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        {file ? <>Selected: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)</> : 'Take a photo or choose a file (JPG, PNG, PDF). You can also drag it here.'}
        <input id="rx" type="file" accept="image/jpeg,image/png,application/pdf" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
      </label>
      {preview && <img className="rxprev" src={preview} alt="Preview" />}
      <div style={{ marginTop: 14 }}>
        <button type="button" disabled={busy} onClick={readIt}>{busy ? 'Reading...' : 'Read it for me'}</button>
      </div>
    </div>
  );
}
