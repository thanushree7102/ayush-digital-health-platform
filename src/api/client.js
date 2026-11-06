import axios from 'axios';

function make(baseURL) {
  const c = axios.create({ baseURL, timeout: 20000 });
  c.interceptors.request.use((cfg) => {
    const token = localStorage.getItem('token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    cfg.headers['X-Correlation-Id'] = crypto.randomUUID();
    cfg.headers['X-Role'] = localStorage.getItem('role') || 'patient';
    try {
      const s = JSON.parse(sessionStorage.getItem('session'));
      if (s && s.doctorId) cfg.headers['X-Doctor-Id'] = s.doctorId;
      if (s && s.adminId) cfg.headers['X-Admin-Id'] = s.adminId;
    } catch (e) { /* ignore */ }
    return cfg;
  });
  return c;
}

// Same origin by default (Vite proxy in dev, Express serves the build in production). Set VITE_API_URL to point elsewhere.
export default make(import.meta.env.VITE_API_URL || '/v1/ayurveda'); // Ayurveda service
export const platform = make(import.meta.env.VITE_PLATFORM_URL || '/v1'); // platform: auth, face, records, consent
