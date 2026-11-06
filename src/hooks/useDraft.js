import { useEffect, useState } from 'react';

// Autosaves form values after a pause (NFR-REL-04). Uses localStorage as a
// fallback; swap saveDraft() for a backend draft endpoint when it exists.
export default function useDraft(key, values, enabled, delay = 2000) {
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => {
      try {
        const at = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify({ values, at }));
        setSavedAt(at);
      } catch (e) { /* storage unavailable: ignore */ }
    }, delay);
    return () => clearTimeout(t);
  }, [values, key, enabled, delay]);

  const load = () => {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  };
  const clear = () => { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } };

  return { savedAt, load, clear };
}
