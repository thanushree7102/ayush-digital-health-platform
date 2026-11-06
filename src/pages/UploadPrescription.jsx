import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { platform } from '../api/client';
import Steps from '../components/Steps';
import { useLang } from '../i18n';

// Step 2 of 2: upload a previous prescription (optional) after registration.
const MAX_MB = 5;
const MAX_FILES = 3;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

export default function UploadPrescription() {
  const { t } = useLang();
  const nav = useNavigate();
  let patient = null;
  try { patient = JSON.parse(sessionStorage.getItem('patient')); } catch (e) { /* ignore */ }

  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [status, setStatus] = useState({ state: 'idle' });

  if (!patient) return <Navigate to="/register" replace />;

  const next = () => nav(`/ayurveda/consultations/${patient.consultationId}/prakriti-vikriti`);

  const addFiles = (list) => {
    let msg = '';
    const ok = [];
    Array.from(list).forEach((f) => {
      if (!ALLOWED.includes(f.type)) msg = `${f.name}: only PDF, JPG or PNG files are allowed.`;
      else if (f.size > MAX_MB * 1024 * 1024) msg = `${f.name}: file is larger than ${MAX_MB} MB.`;
      else ok.push(f);
    });
    const merged = [...files, ...ok];
    if (merged.length > MAX_FILES) msg = `You can upload up to ${MAX_FILES} files.`;
    setFiles(merged.slice(0, MAX_FILES));
    setFileError(msg);
  };

  const upload = async () => {
    if (!files.length) { setFileError('Add at least one file, or choose Skip for now.'); return; }
    setStatus({ state: 'saving' });
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      await platform.post(`/patients/${patient.patientId}/prescriptions`, fd);
      next();
    } catch (err) {
      setStatus({ state: 'error', message: 'Upload failed. Your files are kept; please retry or skip for now.' });
    }
  };

  return (
    <div className="register-wrap">
      <div className="card">
        <Steps current={2} />
        <div className="banner ok">
          Patient registered: <strong>{patient.name}</strong> ({patient.patientId})
        </div>
        <h2>Upload prescription</h2>
        <p className="muted">{t('Optional. Add a previous prescription or report (PDF, JPG or PNG, max {mb} MB each, up to {n} files).', { mb: MAX_MB, n: MAX_FILES })}</p>

        {status.state === 'error' && (
          <div className="banner err">{status.message} <button type="button" onClick={upload}>Retry</button></div>
        )}

        <label className="dropzone" htmlFor="rx"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          Drag files here or click to browse
          <input id="rx" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {fileError && <span className="error-text">{fileError}</span>}

        {files.length > 0 && (
          <ul className="filelist">
            {files.map((f, i) => (
              <li key={f.name + i}>
                {f.type.startsWith('image/') && <img src={URL.createObjectURL(f)} alt="" />}
                <span>{f.name} <span className="muted">({Math.round(f.size / 1024)} KB)</span></span>
                <button type="button" className="secondary" onClick={() => { setFiles(files.filter((_, n) => n !== i)); setFileError(''); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={upload} disabled={status.state === 'saving'}>
            {status.state === 'saving' ? 'Uploading...' : 'Upload and continue'}
          </button>
          <button type="button" className="secondary" onClick={next}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}
