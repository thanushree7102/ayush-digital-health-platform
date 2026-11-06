import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { speak } from '../voice/speech';

// Live camera step used by every role. Gives back { descriptor: 128 numbers }.
// The camera picture stays in the browser; only the 128-number template is sent. No blink needed: just look at the camera.
// (Models are served from /models, shipped inside the npm package: no CDN.)
let faceapiP = null;
const loadFaceApi = () => {
  faceapiP = faceapiP || import('@vladmandic/face-api').then(async (f) => {
    // pick a backend explicitly: GPU (webgl) when the browser has it, otherwise plain CPU
    let okBackend = false;
    try { okBackend = await f.tf.setBackend('webgl'); } catch (e) { okBackend = false; }
    if (!okBackend) await f.tf.setBackend('cpu');
    await f.tf.ready();
    await Promise.all([f.nets.tinyFaceDetector.loadFromUri('/models'), f.nets.faceLandmark68Net.loadFromUri('/models'), f.nets.faceRecognitionNet.loadFromUri('/models')]);
    // run one tiny dummy detection so the first real scan does not pay the start-up cost
    try { const c = document.createElement('canvas'); c.width = c.height = 64; await f.detectSingleFace(c, new f.TinyFaceDetectorOptions({ inputSize: 160 })).withFaceLandmarks().withFaceDescriptor(); } catch (e) { /* no face in the blank picture: expected */ }
    return f;
  }).catch((e) => { faceapiP = null; throw e; });
  return faceapiP;
};
// Start loading the face models early (call while the person is typing their number / filling the form).
export const warmFace = () => { loadFaceApi().catch(() => {}); };

export default function FaceCapture({ onCaptured, buttonLabel, disabled }) {
  const { t, lang } = useLang();
  const video = useRef(null);
  const stream = useRef(null);
  const cancel = useRef(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  const stop = () => { cancel.current = true; stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; setLive(false); };
  useEffect(() => stop, []);

  const say = (m, voice) => { setStatus(m); if (voice) speak(m, lang); };

  const start = async () => {
    cancel.current = false; setBusy(true); setStatus(t('Loading face models…'));
    try {
      const faceapi = await loadFaceApi();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('Camera needs localhost or HTTPS.'));
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      const v = video.current; v.srcObject = stream.current; await v.play(); setLive(true);
      const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.5 });
      say(t('Look straight at the camera.'), true);

      // Take a few clear pictures of the face and average them into one template. No blink needed.
      const samples = []; let lastSample = 0; const end = Date.now() + 40000;
      while (!cancel.current && Date.now() < end && samples.length < 3) {
        const all = await faceapi.detectAllFaces(v, opt).withFaceLandmarks().withFaceDescriptors();
        if (all.length > 1) { setStatus(t('Only one person in the picture, please.')); continue; }
        const f = all[0];
        if (!f) { setStatus(t('No face found. Face the light and keep your whole face in the picture.')); continue; }
        if (f.detection.box.width < v.videoWidth * 0.16) { setStatus(t('Come a little closer.')); continue; }
        if (Date.now() - lastSample < 200) continue;
        const d = Array.from(f.descriptor);
        if (!samples.length || faceapi.euclideanDistance(samples[0], d) < 0.45) { samples.push(d); lastSample = Date.now(); }
        setStatus(t('Hold still…'));
      }
      if (cancel.current) return;
      if (samples.length < 2) throw new Error(t('The face could not be read. Please try again in good light.'));
      const avg = samples[0].map((_, i) => samples.reduce((sum, d) => sum + d[i], 0) / samples.length);
      stop(); setStatus(t('Face captured.'));
      await onCaptured({ descriptor: avg });
    } catch (e) {
      stop(); setStatus(e.message || t('Camera error'));
    } finally { setBusy(false); }
  };

  return (
    <div className="facebox">
      <div className={`facecam${live ? ' live' : ''}`}>
        <video ref={video} muted playsInline />
        {!live && <div className="faceph">🙂</div>}
      </div>
      {status && <p className="facestatus" role="status">{status}</p>}
      {!live ? <button type="button" disabled={busy || disabled} onClick={start}>{busy ? t('Please wait...') : buttonLabel}</button>
        : <button type="button" className="secondary" onClick={() => { stop(); setStatus(''); }}>{t('Cancel')}</button>}
    </div>
  );
}
