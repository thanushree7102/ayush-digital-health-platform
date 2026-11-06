import { PRAKRITI_OPTIONS } from '../constants/options';
import { getActivePatient } from '../utils/session';

// Doctor forms are pre-filled from the patient's last read prescription.
export default function usePrefill(kind) {
  const p = getActivePatient();
  const x = p && p.extracted;
  if (!x) return undefined;
  const meds = (x.medicines || []).map((m) => [m.name, m.dose, m.timing, m.duration].filter(Boolean).join(' ')).join('; ');
  if (kind === 'prakriti') return { prakriti: PRAKRITI_OPTIONS.includes(x.prakriti) ? x.prakriti : '', notes: x.problem ? `From prescription: ${x.problem}` : '' };
  if (kind === 'diagnosis') return { diagnosis: x.diagnosis || '', notes: x.problem ? `Complaints: ${x.problem}` : '' };
  if (kind === 'therapy') return { therapyNotes: meds, dietAdvice: x.advice || '' };
  return undefined;
}
